let Client;
try {
  Client = require('ssh2').Client;
} catch (e) {
  Client = require('d:/Hermes/BotScrapPubgStat/node_modules/ssh2').Client;
}
const fs = require('fs');
const path = require('path');

const config = {
  host: '43.156.17.135',
  port: 22,
  username: 'ubuntu',
  password: 'tiger-96@-desert',
  readyTimeout: 30000
};

console.log('======================================================');
console.log('  🚀 DEPLOYING GEMINI MULTI-ACCOUNT ROUTER TO VPS     ');
console.log(`  🌐 Target Server: ${config.username}@${config.host}:${config.port}`);
console.log('======================================================');

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ SSH Connection established successfully!');

  const setupCommands = [
    'mkdir -p /home/ubuntu/GeminiMultiRouter/data /home/ubuntu/GeminiMultiRouter/services /home/ubuntu/GeminiMultiRouter/public'
  ].join(' && ');

  conn.exec(setupCommands, (err, stream) => {
    if (err) {
      console.error('❌ Setup error:', err.message);
      conn.end();
      return;
    }

    stream.on('close', () => {
      console.log('📁 Remote directories verified.');
      uploadFiles();
    });
  });
});

conn.on('error', (err) => {
  console.error('❌ SSH Connection Error:', err.message);
});

function uploadFiles() {
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ SFTP Error:', err.message);
      conn.end();
      return;
    }

    console.log('📦 Mengunggah file project ke VPS...');
    const localBase = path.join(__dirname, '..');
    const remoteBase = '/home/ubuntu/GeminiMultiRouter';

    const filesToUpload = [
      { local: path.join(localBase, 'package.json'), remote: `${remoteBase}/package.json` },
      { local: path.join(localBase, 'server.js'), remote: `${remoteBase}/server.js` },
      { local: path.join(localBase, 'data', 'config.json'), remote: `${remoteBase}/data/config.json` },
      { local: path.join(localBase, 'data', 'keys.json'), remote: `${remoteBase}/data/keys.json` },
      { local: path.join(localBase, 'services', 'geminiClient.js'), remote: `${remoteBase}/services/geminiClient.js` },
      { local: path.join(localBase, 'services', 'keyPoolManager.js'), remote: `${remoteBase}/services/keyPoolManager.js` },
      { local: path.join(localBase, 'services', 'openAiAdapter.js'), remote: `${remoteBase}/services/openAiAdapter.js` },
      { local: path.join(localBase, 'public', 'index.html'), remote: `${remoteBase}/public/index.html` },
      { local: path.join(localBase, 'public', 'styles.css'), remote: `${remoteBase}/public/styles.css` },
      { local: path.join(localBase, 'public', 'app.js'), remote: `${remoteBase}/public/app.js` }
    ];

    let count = 0;
    filesToUpload.forEach(f => {
      sftp.fastPut(f.local, f.remote, (pErr) => {
        if (pErr) {
          console.warn(`⚠️ Gagal upload ${f.remote}:`, pErr.message);
        } else {
          console.log(`  Uploaded: ${path.basename(f.remote)}`);
        }
        count++;
        if (count === filesToUpload.length) {
          console.log('✅ Semua file berhasil diunggah ke VPS!');
          startRemoteProcess();
        }
      });
    });
  });
}

function startRemoteProcess() {
  const remoteBase = '/home/ubuntu/GeminiMultiRouter';
  const startCmd = [
    `cd ${remoteBase}`,
    'npm install --production',
    'pm2 delete gemini-multi-router || true',
    'pm2 start server.js --name "gemini-multi-router"',
    'pm2 save',
    'pm2 status'
  ].join(' && ');

  console.log('🚀 Memasang dependensi & menjalankan daemon PM2 di VPS...');
  conn.exec(startCmd, (err, stream) => {
    if (err) {
      console.error('❌ Gagal menjalankan service:', err.message);
      conn.end();
      return;
    }

    stream.on('close', () => {
      console.log('======================================================');
      console.log('  🎉 DEPLOYMENT BERHASIL! GEMINI MULTI-ROUTER LIVE!   ');
      console.log('  🌐 Web UI Dashboard : http://43.156.17.135:3003     ');
      console.log('  🔌 OpenAI Upstream API : http://localhost:3003/v1  ');
      console.log('======================================================');
      conn.end();
    }).on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}

conn.connect(config);
