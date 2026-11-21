// 아카이브 백그라운드 확인: 앱이 꺼져 있어도 몇 시간마다 새 버전을 확인해서 폰 알림을 보내요.
const REPO = 'saw94738617-sys/archive-app';
function kvGet(k) {
  try { const r = CapacitorKV.get(k); return r && typeof r === 'object' ? r.value : r; } catch (e) { return null; }
}
function kvSet(k, v) { try { CapacitorKV.set(k, String(v)); } catch (e) {} }

addEventListener('setBuild', (resolve, reject, args) => {
  try {
    if (args && args.build) kvSet('build', args.build);
    if (args && args.dev != null) kvSet('dev', args.dev ? '1' : '0');
    resolve({ ok: true, build: kvGet('build') });
  } catch (e) { reject(e); }
});

addEventListener('checkUpdate', async (resolve, reject, args) => {
  try {
    const cur = parseInt(kvGet('build') || '0', 10);
    if (!cur) { resolve(); return; }
    const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'archive-app' }
    });
    if (!res.ok) { resolve(); return; }
    const j = await res.json();
    const m = String(j.tag_name || '').match(/(\d+)$/);
    const n = m ? parseInt(m[1], 10) : 0;
    const told = parseInt(kvGet('notified') || '0', 10);
    if (n > cur && n > told) {
      const ver = String(j.tag_name || '').replace(/^v/, '');
      const first = String(j.body || '').split('\n').map(s => s.trim()).filter(s => s && !/APK|archive-/.test(s))[0] || '눌러서 업데이트하세요';
      CapacitorNotifications.schedule([{ id: 7000 + (n % 1000), title: '아카이브 새 버전 ' + ver, body: first }]);
      kvSet('notified', n);
    }
    resolve();
  } catch (e) { reject(e); }
});
