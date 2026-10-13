// Inside the Playwright container: make localhost:8080/8081/9000 reach the compose services, so the browser
// sees exactly the URLs a user sees on the host (Keycloak redirects, presigned S3 URLs) — no config changes.
import net from 'node:net';

const map = { 8080: ['web', 80], 8081: ['keycloak', 8080], 9000: ['minio', 9000] };
for (const [port, [host, target]] of Object.entries(map)) {
  net.createServer(c => {
    const u = net.connect(target, host);
    c.pipe(u).pipe(c);
    const close = () => { c.destroy(); u.destroy(); };
    c.on('error', close);
    u.on('error', close);
  }).listen(Number(port), '127.0.0.1');
}
console.log('forwarding localhost:8080→web:80, :8081→keycloak:8080, :9000→minio:9000');
