const express = require('express');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());

let qrData = null;
let sock = null;
let botLid = null;

/* ------------------------------------------------------------------
 | CONFIG
 ------------------------------------------------------------------ */

const LATEST_URL = 'https://wabot256.my.id/api/latest-file';
const TEMP_EXCEL_PATH = path.join(__dirname, 'temp.xlsx');
const SESSION_DIR = path.join(__dirname, 'sessions');
const QR_TXT_PATH = path.join(__dirname, 'qr.txt');

// Paksa IPv4
const httpsAgent = new https.Agent({
    family: 4,
    keepAlive: true
});

/* ------------------------------------------------------------------
 | DOWNLOAD EXCEL DARI HOSTING
 | Endpoint /api/latest-file langsung mengirim file XLSX.
 ------------------------------------------------------------------ */

async function downloadExcel() {
    try {
        console.log('=================================');
        console.log('AMBIL FILE EXCEL TERBARU...');
        console.log('LATEST_URL:', LATEST_URL);

        const response = await axios.get(LATEST_URL + '?t=' + Date.now(), {
            responseType: 'arraybuffer',
            timeout: 60000,
            httpsAgent: httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*',
                'Cache-Control': 'no-cache'
            },
            validateStatus: status => status >= 200 && status < 300
        });

        console.log('EXCEL RESPONSE STATUS:', response.status);
        console.log('EXCEL SIZE:', response.data.length, 'bytes');

        if (!response.data || response.data.length < 1000) {
            console.log('ERROR: File Excel terlalu kecil / kosong');
            return null;
        }

        if (fs.existsSync(TEMP_EXCEL_PATH)) {
            try {
                fs.unlinkSync(TEMP_EXCEL_PATH);
            } catch (err) {
                console.log('GAGAL HAPUS TEMP EXCEL:', err.message);
            }
        }

        fs.writeFileSync(TEMP_EXCEL_PATH, response.data);

        // Validasi file Excel
        try {
            XLSX.readFile(TEMP_EXCEL_PATH);
        } catch (err) {
            console.log('ERROR: File yang didownload bukan Excel valid');
            console.log(err.message);
            return null;
        }

        console.log('EXCEL UPDATED:', TEMP_EXCEL_PATH);
        console.log('=================================');

        return TEMP_EXCEL_PATH;

    } catch (err) {
        console.log('=================================');
        console.log('❌ GAGAL AMBIL EXCEL');
        console.log('ERROR NAME:', err.name);
        console.log('ERROR MESSAGE:', err.message);
        console.log('ERROR CODE:', err.code);
        console.log('ERROR STATUS:', err.response?.status || '-');

        if (err.code === 'ETIMEDOUT') {
            console.log('Koneksi timeout. Request sudah dipaksa menggunakan IPv4.');
        }

        console.log('=================================');
        return null;
    }
}

/* ------------------------------------------------------------------
 | LOAD EXCEL
 ------------------------------------------------------------------ */

function loadExcelData(filePath) {
    const workbook = XLSX.readFile(filePath);
    let allData = [];

    workbook.SheetNames.forEach(sheetName => {
        console.log('BACA SHEET:', sheetName);

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, {
            defval: '',
            raw: false
        });

        const filtered = data.filter(item => {
            const skuKey = Object.keys(item).find(k =>
                String(k).toLowerCase().includes('sku')
            );

            if (!skuKey) {
                return false;
            }

            return String(item[skuKey] || '').trim() !== '';
        });

        allData = [...allData, ...filtered];
    });

    return allData;
}

/* ------------------------------------------------------------------
 | HELPER
 ------------------------------------------------------------------ */

const cleanSku = value =>
    String(value || '')
        .replace(/[^\w]/g, '')
        .trim()
        .toUpperCase();

const HARGA_MAP = {
    'harga open': { match: 'harga open', label: 'Harga Open' },
    'harga nett chat': { match: 'nett chat', label: 'Harga Nett Chat' },
    'harga nett toko': { match: 'nett toko', label: 'Harga Nett Toko' }
};

function reply(from, msg, text) {
    return sock.sendMessage(from, { text }, { quoted: msg });
}

/* ------------------------------------------------------------------
 | MESSAGE HANDLER
 ------------------------------------------------------------------ */

async function handleMessage(msg) {
    if (!msg.message) {
        return;
    }

    const from = msg.key.remoteJid;

    // Ambil teks
    const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

    if (!text) {
        return;
    }

    console.log('PESAN MASUK:', text);

    // Cek mention
    const mentionedJid =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const botJidClean = sock.user?.id?.split(':')[0];

    console.log('=== DEBUG ===');
    console.log('BOT JID:', sock.user?.id);
    console.log('BOT LID:', botLid);
    console.log('MENTIONED JID:', mentionedJid);
    console.log('=============');

    const isBotMentioned = mentionedJid.some(jid => {
        const cleanJid = jid
            .split(':')[0]
            .replace('@lid', '')
            .replace('@s.whatsapp.net', '');

        return cleanJid === botLid || cleanJid === botJidClean;
    });

    if (!isBotMentioned) {
        return;
    }

    // Download Excel terbaru
    const excel = await downloadExcel();

    if (!excel) {
        await reply(from, msg, 'File Excel terbaru gagal diambil 😭');
        return;
    }

    // Hapus tag bot
    const cleanText = text.replace(/@\S+/g, '').trim();
    console.log('CLEAN TEXT:', cleanText);

    // Format: SKU | Jenis Harga
    const splitText = cleanText.split('|');

    if (splitText.length < 2) {
        await reply(
            from,
            msg,
`iyaa, mau tanya apaaa?

Contoh perintah:
- @bot SKU-001 | Harga Open
- @bot SKU-001 | Harga Nett Chat
- @bot SKU-001 | Harga Nett Toko`
        );
        return;
    }

    const skuPart = splitText[0].trim();
    const jenisHarga = splitText[1].trim().toLowerCase();

    console.log('SKU:', skuPart);
    console.log('JENIS:', jenisHarga);

    // Load Excel
    const dataExcel = loadExcelData(excel);

    if (!dataExcel || dataExcel.length === 0) {
        await reply(from, msg, 'Data Excel kosong 😭');
        return;
    }

    // Cari SKU
    const inputSku = cleanSku(skuPart);

    const laptop = dataExcel.find(item => {
        const skuKey = Object.keys(item).find(
            k => String(k).trim().toLowerCase() === 'sku'
        );

        if (!skuKey) {
            return false;
        }

        return cleanSku(item[skuKey]) === inputSku;
    });

    if (!laptop) {
        await reply(from, msg, `SKU ${skuPart} tidak ditemukan 😭`);
        return;
    }

    // Cek status
    const status = String(laptop['Status'] || '').trim().toLowerCase();
    const statusText = laptop['Status'] || '-';

    if (
        status.includes('sold') ||
        status.includes('dp') ||
        status.includes('not ready')
    ) {
        await reply(
            from,
            msg,
            `❌ SKU ${skuPart} sudah ${status.toUpperCase()} ❌`
        );
        return;
    }

    // Pilih harga
    const jenis = HARGA_MAP[jenisHarga];

    if (!jenis) {
        await reply(
            from,
            msg,
`Jenis harga tidak valid 😭

Pilihan:
- Harga Open
- Harga Nett Chat
- Harga Nett Toko`
        );
        return;
    }

    const hargaKey = Object.keys(laptop).find(k =>
        String(k).toLowerCase().includes(jenis.match)
    );

    const harga = hargaKey ? laptop[hargaKey] : null;

    // Format harga
    const hargaNumber =
        parseInt(String(harga).replace(/[^\d]/g, '')) || 0;

    const formatHarga = new Intl.NumberFormat('id-ID').format(hargaNumber);

    // Respon bot
    await reply(
        from,
        msg,
`💻 ${laptop['Unit dan Spesifikasi'] || '-'}

📦 SKU: ${laptop['SKU'] || '-'}

💰 ${jenis.label}
Rp ${formatHarga}

📌 Status: ${statusText}

🛠 Kondisi: ${laptop['Kondisi'] || '-'}`
    );
}

/* ------------------------------------------------------------------
 | START BOT
 ------------------------------------------------------------------ */

let reconnectTimer = null;

function scheduleReconnect(delay = 5000) {
    if (reconnectTimer) {
        return;
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        console.log('MENCOBA CONNECT ULANG...');
        startBot();
    }, delay);
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        // Pakai versi WhatsApp Web terbaru supaya tidak ditolak (error 405)
        const { version } = await fetchLatestBaileysVersion();
        console.log('WA VERSION:', version.join('.'));

        const currentSock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['Windows', 'Chrome', '120.0.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            defaultQueryTimeoutMs: 60000
        });

        sock = currentSock;

        // Simpan sesi
        currentSock.ev.on('creds.update', saveCreds);

        // Status koneksi
        currentSock.ev.on('connection.update', async (update) => {

            // Abaikan event dari socket lama
            if (currentSock !== sock) {
                return;
            }

            const { qr, connection, lastDisconnect } = update;

            // QR siap
            if (qr) {
                console.log('QR READY');

                qrData = await QRCode.toDataURL(qr);
                fs.writeFileSync(QR_TXT_PATH, qr);
            }

            // Bot terhubung
            if (connection === 'open') {
                console.log('BOT CONNECTED');
                console.log('BOT USER:', JSON.stringify(currentSock.user));

                qrData = null; // QR tidak diperlukan lagi

                if (currentSock.user?.lid) {
                    botLid = currentSock.user.lid.split(':')[0];
                    console.log('BOT LID:', botLid);
                }

                await downloadExcel();
            }

            // Bot terputus
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;

                console.log('BOT DISCONNECTED, CODE:', code);
                console.log('REASON:', lastDisconnect?.error?.message || '-');

                sock = null;

                // Sesi tidak valid / perangkat dikeluarkan dari HP:
                // hapus sesi supaya QR baru bisa muncul
                if (code === DisconnectReason.loggedOut) {
                    console.log('SESI LOGOUT, HAPUS FOLDER SESSIONS...');

                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    qrData = null;
                }

                scheduleReconnect(5000);
            }
        });

        // Pesan masuk
        currentSock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                await handleMessage(messages[0]);
            } catch (err) {
                console.log('ERROR:', err);
            }
        });

    } catch (err) {
        console.log('START BOT ERROR:', err);
        scheduleReconnect(5000);
    }
}

startBot();

/* ------------------------------------------------------------------
 | ROUTES
 ------------------------------------------------------------------ */

app.get('/qr', (req, res) => {
    return res.json({
        success: true,
        data: { qr: qrData }
    });
});

app.get('/qrraw', (req, res) => {
    try {
        res.send(fs.readFileSync(QR_TXT_PATH, 'utf8'));
    } catch {
        res.send('QR belum ada');
    }
});

app.post('/api/sessions/add', (req, res) => {
    return res.json({
        success: true,
        data: { qr: qrData }
    });
});

app.get('/api/sessions/status/:code', (req, res) => {
    try {
        return res.json({
            success: true,
            data: {
                connected: sock?.user ? true : false,
                device_number: sock?.user?.id || null
            }
        });
    } catch (err) {
        return res.json({ success: false });
    }
});

/* ------------------------------------------------------------------
 | SERVER
 ------------------------------------------------------------------ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
});
