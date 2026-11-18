// 실시간 멀티 연결 (끊기면 다시 연결)
export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.id = null;
    this.hello = null;
    this.retry = 1000;
    this.lastSend = 0;
  }
  connect(nick, tail) {
    this.hello = { t: 'hello', nick, tail };
    this.open();
  }
  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.retry = 1000;
      ws.send(JSON.stringify(this.hello));
      this.h.status?.('연결됨');
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      this.h[m.t]?.(m);
    };
    ws.onclose = () => {
      this.h.status?.('연결 끊김, 다시 연결 중');
      setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(15000, this.retry * 2);
    };
    ws.onerror = () => {};
  }
  sendState(s) {
    const now = performance.now();
    if (now - this.lastSend < 100 || this.ws?.readyState !== 1) return;
    this.lastSend = now;
    this.ws.send(JSON.stringify({ t: 'state', ...s }));
  }
  chat(text) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'chat', text }));
  }
}
