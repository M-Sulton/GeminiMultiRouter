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

function executeCmd(command, stepName) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ [${stepName}] Menjalankan: ${command}`);
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      stream.on('data', (data) => {
        process.stdout.write(data);
      });
      stream.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
      stream.on('close', (code) => {
        resolve(code);
      });
    });
  });
}

function uploadFileList(sftp, files) {
  return new Promise((resolve, reject) => {
    let completed = 0;
    files.forEach((f) => {
      sftp.fastPut(f.local, f.remote, (err) => {
        if (err) {
          console.error(`❌ Gagal upload: ${f.local} -> ${f.remote}:`, err.message);
          return reject(err);
        }
        console.log(`  ✔ Uploaded: ${path.basename(f.remote)}`);
        completed++;
        if (completed === files.length) {
          resolve();
        }
      });
    });
  });
}

conn.on('ready', async () => {
  console.log('✅ SSH Connection established successfully!');

  try {
    await executeCmd(
      'mkdir -p /home/ubuntu/GeminiMultiRouter/data /home/ubuntu/GeminiMultiRouter/services /home/ubuntu/GeminiMultiRouter/public',
      'Membuat direktori remote'
    );

    const localBase = path.join(__dirname, '..');
    const remoteBase = '/home/ubuntu/GeminiMultiRouter';

    const filesToUpload = [
      { local: path.join(localBase, 'package.json'), remote: `${remoteBase}/package.json` },
      { local: path.join(localBase, 'server.js'), remote: `${remoteBase}/server.js` },
      { local: path.join(localBase, 'data', 'config.json'), remote: `${remoteBase}/data/config.json` },
      { local: path.join(localBase, 'services', 'geminiClient.js'), remote: `${remoteBase}/services/geminiClient.js` },
      { local: path.join(localBase, 'services', 'keyPoolManager.js'), remote: `${remoteBase}/services/keyPoolManager.js` },
      { local: path.join(localBase, 'services', 'openAiAdapter.js'), remote: `${remoteBase}/services/openAiAdapter.js` },
      { local: path.join(localBase, 'public', 'index.html'), remote: `${remoteBase}/public/index.html` },
      { local: path.join(localBase, 'public', 'styles.css'), remote: `${remoteBase}/public/styles.css` },
      { local: path.join(localBase, 'public', 'app.js'), remote: `${remoteBase}/public/app.js` }
    ];

    console.log('\n📦 Mengunggah file project ke VPS...');
    await new Promise((resolve, reject) => {
      conn.sftp(async (err, sftp) => {
        if (err) return reject(err);
        try {
          await uploadFileList(sftp, filesToUpload);
          resolve();
        } catch (uErr) {
          reject(uErr);
        }
      });
    });

    console.log('✅ File upload selesai!');

    await executeCmd(
      `cd ${remoteBase} && pm2 restart gemini-multi-router || (pm2 start server.js --name "gemini-multi-router" && pm2 save)`,
      'Restarting PM2 Service'
    );

    await executeCmd('pm2 status', 'Status PM2');

    console.log('\n======================================================');
    console.log('  🎉 DEPLOYMENT BERHASIL! GEMINI MULTI-ROUTER LIVE!   ');
    console.log('  🌐 Domain URL   : https://tonhermes.web.id/9routerui/');
    console.log('  🔌 OpenAI Upstream API : http://localhost:3003/v1  ');
    console.log('======================================================');

    conn.end();
  } catch (err) {
    console.error('❌ Error during deployment:', err.message);
    conn.end();
  }
});

conn.on('error', (err) => {
  console.error('❌ SSH Connection Error:', err.message);
});

conn.connect(config);
