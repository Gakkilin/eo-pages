export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secretPath = '/48d13615'; // 你的暗号路径
    const targetHost = '48d13615-9311-4fb6-96f9-d66362573314'; // 【重点】填入你的 Koyeb 域名

    // 1. 如果路径匹配暗号，执行代理逻辑
    if (url.pathname === secretPath) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader === 'websocket') {
        url.hostname = targetHost;
        const newRequest = new Request(url, request);
        newRequest.headers.set('Host', targetHost);
        return fetch(newRequest);
      }
    }

    // 2. 如果路径是首页，显示伪装页
    if (url.pathname === '/') {
      return env.ASSETS.fetch(request);
    }

    // 3. 其他乱跑的扫描器请求，直接返回404，节省你的额度
    return new Response('Not Found', { status: 404 });
  }
};
