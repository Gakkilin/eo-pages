/**
 * EdgeOne Vless 动态反代版
 * 支持功能：
 * 1. 默认 EO 出口直连
 * 2. URL 携带 proxyip=xxx 时，通过反代 IP 落地
 */

const userID = '48d13615-9311-4fb6-96f9-d66362573314'; // 必须与客户端一致

export const onRequest = async (context) => {
    const { request } = context;
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // 获取路径中的 proxyip 参数
    // 例如：https://yourdomain.com/vless?proxyip=1.2.3.4
    const customProxyIP = url.searchParams.get('proxyip');

    if (upgradeHeader === 'websocket') {
        return await vlessOverWSHandler(request, customProxyIP);
    }

    // 伪装页面，显示当前模式
    const modeInfo = customProxyIP ? `Proxy Mode (Landing via: ${customProxyIP})` : "Direct Mode (Landing via EO)";
    return new Response(`Service Operational: ${modeInfo}`, { status: 200 });
};

async function vlessOverWSHandler(request, customProxyIP) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();

    let remoteSocket = null;
    const decoder = new TextDecoder();

    server.addEventListener('message', async ({ data }) => {
        if (remoteSocket) {
            const writer = remoteSocket.writable.getWriter();
            await writer.write(data);
            writer.releaseLock();
            return;
        }

        const buffer = data;
        if (buffer.byteLength < 18) return;

        // --- 1. 校验 UUID ---
        const id = new Uint8Array(buffer.slice(1, 17));
        const uuidStr = [...id].map(b => b.toString(16).padStart(2, '0')).join('');
        const formattedUUID = `${uuidStr.slice(0, 8)}-${uuidStr.slice(8, 12)}-${uuidStr.slice(12, 16)}-${uuidStr.slice(16, 20)}-${uuidStr.slice(20)}`;

        if (formattedUUID !== userID.toLowerCase()) {
            server.close();
            return;
        }

        // --- 2. 解析目标地址 ---
        const optLength = new Uint8Array(buffer.slice(17, 18))[0];
        const port = new DataView(buffer.slice(19 + optLength, 21 + optLength)).getUint16(0);
        const addressType = new Uint8Array(buffer.slice(21 + optLength, 22 + optLength))[0];

        let address = "";
        let addressEndIndex = 22 + optLength;
        if (addressType === 1) { // IPv4
            address = new Uint8Array(buffer.slice(22 + optLength, 26 + optLength)).join('.');
            addressEndIndex += 4;
        } else if (addressType === 2) { // Domain
            const domainLen = new Uint8Array(buffer.slice(22 + optLength, 23 + optLength))[0];
            address = decoder.decode(buffer.slice(23 + optLength, 23 + optLength + domainLen));
            addressEndIndex += 1 + domainLen;
        }

        // --- 3. 决定落地 IP ---
        // 如果 URL 带了 proxyip，则连接 proxyip 的 443 端口
        // 如果没带，则直接连接用户想要访问的目标 address 和 port
        const finalHost = customProxyIP ? customProxyIP : address;
        const finalPort = customProxyIP ? 443 : port;

        try {
            // 使用 EdgeOne 提供的标准 TCP 连接 API
            const socket = connect({
                hostname: finalHost,
                port: finalPort,
            });

            remoteSocket = socket;

            // VLESS 握手回显
            const version = new Uint8Array(buffer.slice(0, 1));
            server.send(new Uint8Array([version[0], 0]));

            // 转发剩余首包数据
            const writer = socket.writable.getWriter();
            await writer.write(buffer.slice(addressEndIndex));
            writer.releaseLock();

            // 双向数据流绑定
            socket.readable.pipeTo(new WritableStream({
                write(chunk) { server.send(chunk); },
                close() { server.close(); }
            }));
        } catch (err) {
            server.close();
        }
    });

    return new Response(null, { status: 101, webSocket: client });
}

