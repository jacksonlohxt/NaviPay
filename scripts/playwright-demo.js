const { spawn } = require('node:child_process');

const fixturePort = process.env.NAVIPAY_FIXTURE_PORT || '43123';
const appPort = process.env.PORT || '3000';
const fixture = spawn('python3', ['-m', 'http.server', fixturePort, '--directory', 'fixtures'], { stdio: 'inherit' });
const app = spawn(process.execPath, ['src/server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: appPort,
    NAVIPAY_PLAYWRIGHT_DISCOVERY: '1',
    NAVIPAY_DISCOVERY_ALLOWLIST: '127.0.0.1',
    NAVIPAY_DISCOVERY_URLS: `http://127.0.0.1:${fixturePort}/competition-site/`
  }
});

console.log(`Competition replay site: http://127.0.0.1:${fixturePort}/competition-site/`);
console.log(`NaviPay: http://127.0.0.1:${appPort}`);
console.log('Press Ctrl-C to stop both local processes.');

function stop() {
  if (!fixture.killed) fixture.kill('SIGTERM');
  if (!app.killed) app.kill('SIGTERM');
}
process.once('SIGINT', () => { stop(); process.exit(0); });
process.once('SIGTERM', () => { stop(); process.exit(0); });
app.once('exit', (code) => {
  if (code !== 0) stop();
});
fixture.once('exit', (code) => {
  if (code !== 0) app.kill('SIGTERM');
});
