const express = require('express');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const {
    default: makeWASocket,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const app = express();

app.use(express.json());

let qrData = null;
let sock = null;
let botLid = null;
/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const LATEST_URL =
'https://wabot256.my.id/wabot/public/uploads/latest.txt';
const LOCAL_EXCEL_PATH =
    path.join(__dirname, 'temp-' + Date.now() + '.xlsx');
/*
|--------------------------------------------------------------------------
| DOWNLOAD EXCEL DARI HOSTING
|--------------------------------------------------------------------------
*/

async function downloadExcel() {

    try {

        console.log('AMBIL FILE TERBARU...');

        /*
        |--------------------------------------------------------------------------
        | AMBIL NAMA FILE TERBARU
        |--------------------------------------------------------------------------
        */

        const latestResponse = await axios.get(
            LATEST_URL + '?t=' + Date.now()
        );

const latestFile = String(latestResponse.data).trim();

        console.log('FILE:', latestFile);

        console.log('DOWNLOAD URL:',
'https://wabot256.my.id/wabot/public/uploads/' + latestFile);
        /*
        |--------------------------------------------------------------------------
        | DOWNLOAD FILE EXCEL
        |--------------------------------------------------------------------------
        */

        const response = await axios({
            method: 'GET',
            url:
                'https://wabot256.my.id/wabot/public/uploads/' +
                latestFile +
                '?t=' +
                Date.now(),
            responseType: 'arraybuffer'
        });

        /*
        |--------------------------------------------------------------------------
        | SIMPAN FILE SEMENTARA
        |--------------------------------------------------------------------------
        */

        const tempPath =
    path.join(__dirname, 'temp.xlsx');

if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
}

fs.writeFileSync(
    tempPath,
    response.data
);

        fs.writeFileSync(
            tempPath,
            response.data
        );

        console.log('EXCEL UPDATED');

        return tempPath;

    } catch (err) {

        console.log(err.message);

        return null;
    }
}

/*
|--------------------------------------------------------------------------
| LOAD EXCEL
|--------------------------------------------------------------------------
*/

function loadExcelData(filePath) {

    const workbook =
        XLSX.readFile(filePath);

    let allData = [];

    workbook.SheetNames.forEach(sheetName => {

        console.log('BACA SHEET:', sheetName);

        const sheet =
            workbook.Sheets[sheetName];

        const data =
            XLSX.utils.sheet_to_json(sheet, {
                defval: '',
                raw: false
            });

        const filtered = data.filter(item => {

    const skuKey = Object.keys(item)
        .find(k =>
            String(k)
            .toLowerCase()
            .includes('sku')
        );

    if (!skuKey) return false;

    const sku =
        String(item[skuKey] || '')
        .trim();

    return sku !== '';
});

        allData = [
            ...allData,
            ...filtered
        ];
    });

    return allData;
}
/*
|--------------------------------------------------------------------------
| START BOT
|--------------------------------------------------------------------------
*/

async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState('sessions');

    sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Windows', 'Chrome', '120.0.0'],

    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000,
});

    /*
    |--------------------------------------------------------------------------
    | SAVE SESSION
    |--------------------------------------------------------------------------
    */

    sock.ev.on('creds.update', saveCreds);

    /*
    |--------------------------------------------------------------------------
    | CONNECTION UPDATE
    |--------------------------------------------------------------------------
    */

    sock.ev.on('connection.update', async (update) => {

        const { qr, connection } = update;

       if (qr) {

    console.log('QR READY');

    qrData = await QRCode.toDataURL(qr);

    fs.writeFileSync(
        './qr.txt',
        qr
    );
}
app.get('/qrraw', (req, res) => {

    try {

        const qr =
            fs.readFileSync('./qr.txt', 'utf8');

        res.send(qr);

    } catch {

        res.send('QR belum ada');
    }
});

        if (connection === 'open') {

            console.log('BOT CONNECTED');
            console.log('BOT USER:', JSON.stringify(sock.user));

            if (sock.user?.lid) {
        botLid = sock.user.lid.split(':')[0];
        console.log('BOT LID:', botLid);
    }
            /*
            |--------------------------------------------------------------------------
            | DOWNLOAD EXCEL SAAT BOT CONNECT
            |--------------------------------------------------------------------------
            */

            await downloadExcel();
        }

       if (connection === 'close') {

    console.log('BOT DISCONNECTED');

    setTimeout(() => {
        startBot();
    }, 5000);
}
    });

    /*
    |--------------------------------------------------------------------------
    | MESSAGE HANDLER
    |--------------------------------------------------------------------------
    */

    sock.ev.on('messages.upsert', async ({ messages }) => {

        try {

            const msg = messages[0];

            if (!msg.message) return;

            const from = msg.key.remoteJid;

            /*
            |--------------------------------------------------------------------------
            | AMBIL TEXT
            |--------------------------------------------------------------------------
            */

            const text =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                '';

            if (!text) return;

            console.log('PESAN MASUK:', text);

        
            /*
            |--------------------------------------------------------------------------
            | CEK MENTION
            |--------------------------------------------------------------------------
            */

            // GANTI BAGIAN INI
const mentionedJid =
    msg.message?.extendedTextMessage
    ?.contextInfo
    ?.mentionedJid || [];

console.log('=== DEBUG ===');
console.log('BOT JID:', sock.user?.id);
console.log('BOT LID:', botLid);
console.log('MENTIONED JID:', mentionedJid);
console.log('=============');

// Cek apakah bot yang di-tag (support format LID dan JID biasa)
const botJidClean = sock.user?.id?.split(':')[0];

const isBotMentioned = mentionedJid.some(jid => {
    const cleanJid = jid.split(':')[0].replace('@lid', '').replace('@s.whatsapp.net', '');
    return (
        cleanJid === botLid ||
        cleanJid === botJidClean
    );
});

if (!isBotMentioned) return;
            /*
            |--------------------------------------------------------------------------
            | HARUS TAG BOT
            |--------------------------------------------------------------------------
            */

            if (mentionedJid.length === 0) return;
// Ambil JID bot sendiri
const botJid = sock.user.id.replace(':0@', '@').replace(/:\d+/, '');

// Cek apakah bot yang di-tag

if (!isBotMentioned) return;
            /*
            |--------------------------------------------------------------------------
            | DOWNLOAD EXCEL TERBARU SETIAP ADA CHAT
            |--------------------------------------------------------------------------
            */

            await downloadExcel();

            /*
            |--------------------------------------------------------------------------
            | HAPUS TAG BOT
            |--------------------------------------------------------------------------
            */

            const cleanText = text
                .replace(/@\S+/g, '')
                .trim();

            console.log('CLEAN TEXT:', cleanText);

            /*
            |--------------------------------------------------------------------------
            | FORMAT:
            | SKU-001 | Harga Open
            |--------------------------------------------------------------------------
            */

            const splitText = cleanText.split('|');

            if (splitText.length < 2) {

                await sock.sendMessage(from, {
                    text:
`iyaa, mau tanya apaaa?

Contoh perintah:
- @bot SKU-001 | Harga Open
- @bot SKU-001 | Harga Nett Chat
- @bot SKU-001 | Harga Nett Toko`
                }
            ,{ quoted: msg });
                

                return;
            }

            /*
            |--------------------------------------------------------------------------
            | SKU
            |--------------------------------------------------------------------------
            */

            const skuPart =
                splitText[0]
                .trim();

            /*
            |--------------------------------------------------------------------------
            | JENIS HARGA
            |--------------------------------------------------------------------------
            */

            const jenisHarga =
                splitText[1]
                .trim()
                .toLowerCase();

            console.log('SKU:', skuPart);
            console.log('JENIS:', jenisHarga);

            /*
            |--------------------------------------------------------------------------
            | LOAD EXCEL
            |--------------------------------------------------------------------------
            */

            const latestExcel =
    await downloadExcel();

if (!latestExcel) {

    await sock.sendMessage(from, {
        text:
            'File Excel terbaru gagal diambil 😭'
    } ,{ quoted: msg });

    return;
}

const dataExcel =
    loadExcelData(latestExcel);

if (!dataExcel || dataExcel.length === 0) {

    await sock.sendMessage(from, {
        text:
            'Data Excel kosong 😭'
    } ,{ quoted: msg });

    return;
}
            /*
            |--------------------------------------------------------------------------
            | CARI SKU
            |--------------------------------------------------------------------------
            */

            const laptop = dataExcel.find(item => {

    const skuKey = Object.keys(item)
        .find(k =>
            String(k)
            .trim()
            .toLowerCase() === 'sku'
        );

    if (!skuKey) return false;

    const cleanSku = (value) => {
    return String(value || '')
        .replace(/[^\w]/g, '')
        .trim()
        .toUpperCase();
};

const excelSku = cleanSku(item[skuKey]);
const inputSku = cleanSku(skuPart);

    return excelSku === inputSku;
});
            /*
            |--------------------------------------------------------------------------
            | SKU TIDAK DITEMUKAN
            |--------------------------------------------------------------------------
            */

            if (!laptop) {

    await sock.sendMessage(from, {
        text: `SKU ${skuPart} tidak ditemukan 😭`
    } ,{ quoted: msg });

    return;
}

const status =
    String(laptop['Status'] || '')
    .trim()
    .toLowerCase();
const statusText = laptop['Status'] || '-';
if (
    status.includes('sold') ||
    status.includes('dp') ||
    status.includes('not ready')
) {

    await sock.sendMessage(from, {
        text:
`❌ SKU ${skuPart} sudah ${status.toUpperCase()} ❌`
    } ,{ quoted: msg });

    return;
}
            /*
            |--------------------------------------------------------------------------
            | PILIH HARGA
            |--------------------------------------------------------------------------
            */

            let harga = null;
            let label = '';

        if (jenisHarga === 'harga open') {

    const hargaKey = Object.keys(laptop)
        .find(k =>
            String(k)
            .toLowerCase()
            .includes('harga open')
        );

    harga = laptop[hargaKey];
    label = 'Harga Open';
}

else if (jenisHarga === 'harga nett chat') {

    const hargaKey = Object.keys(laptop)
        .find(k =>
            String(k)
            .toLowerCase()
            .includes('nett chat')
        );

    harga = laptop[hargaKey];
    label = 'Harga Nett Chat';
}

else if (jenisHarga === 'harga nett toko') {

    const hargaKey = Object.keys(laptop)
        .find(k =>
            String(k)
            .toLowerCase()
            .includes('nett toko')
        );

    harga = laptop[hargaKey];
    label = 'Harga Nett Toko';
}

            else {

                await sock.sendMessage(from, {
                    text:
`Jenis harga tidak valid 😭

Pilihan:
- Harga Open
- Harga Nett Chat
- Harga Nett Toko`
                } ,{ quoted: msg });

                return;
            }

            /*
            |--------------------------------------------------------------------------
            | FORMAT HARGA
            |--------------------------------------------------------------------------
            */

            const hargaNumber =
    parseInt(
        String(harga)
        .replace(/[^\d]/g, '')
    ) || 0;

const formatHarga =
    new Intl.NumberFormat('id-ID')
    .format(hargaNumber);
            /*
            |--------------------------------------------------------------------------
            | RESPON BOT
            |--------------------------------------------------------------------------
            */

            await sock.sendMessage(from, {
                text:
`💻 ${laptop['Unit dan Spesifikasi'] || '-'}

📦 SKU: ${laptop['SKU'] || '-'}
💰 ${label}
Rp ${formatHarga}

📌 Status: ${statusText}
🛠 Kondisi: ${laptop['Kondisi'] || '-'}`
            } ,{ quoted: msg });

        } catch (err) {

            console.log('ERROR:', err);

        }

    });
}

/*
|--------------------------------------------------------------------------
| START BOT
|--------------------------------------------------------------------------
*/

startBot();

/*
|--------------------------------------------------------------------------
| QR ROUTE
|--------------------------------------------------------------------------
*/

app.get('/qr', async (req, res) => {

    return res.json({
        success: true,
        data: {
            qr: qrData
        }
    });
});

/*
|--------------------------------------------------------------------------
| API SESSION ADD
|--------------------------------------------------------------------------
*/

app.post('/api/sessions/add', async (req, res) => {

    return res.json({
        success: true,
        data: {
            qr: qrData
        }
    });
});

/*
|--------------------------------------------------------------------------
| API STATUS BOT
|--------------------------------------------------------------------------
*/

app.get('/api/sessions/status/:code', async (req, res) => {

    try {

        const isConnected =
            sock?.user ? true : false;

        return res.json({
            success: true,
            data: {
                connected: isConnected,
                device_number: sock?.user?.id || null
            }
        });

    } catch (err) {

        return res.json({
            success: false
        });
    }
});

/*
|--------------------------------------------------------------------------
| SERVER
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {

    console.log('Server running on port ' + PORT);

});
