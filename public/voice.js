// Voice chat: one WebRTC audio connection per pair of players (fine for 9–16 people).
// The server decides who may be heard (state.audio): we only send our mic to `sendTo`,
// and only play peers listed in `hear`. Sending is gated on the sender's side, so a
// modified client can't listen in on the mafia at night.

// shortcut: STUN only, no TURN server — players on some strict/mobile networks won't hear each other; add a TURN server before a public launch.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

class Voice {
  constructor(socket) {
    this.socket = socket;
    this.mic = null;
    this.peers = new Map(); // playerId -> { pc, key, tr, audio, pending }
    this.state = null;
    socket.on('rtc', ({ from, data }) => this.onSignal(from, data));
    // Browsers block audio until the user clicks; retry playback on any click.
    document.addEventListener('click', () => this.peers.forEach(p => p.audio.play().catch(() => {})));
  }

  status(text) { const el = document.getElementById('micStatus'); if (el) el.textContent = text; }

  async startMic() {
    if (this.mic) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.mic = stream.getAudioTracks()[0];
    } catch {
      this.mic = null;
      this.status('🚫 Mikrofon yok: sadece dinleyebilirsin');
    }
    this.peers.forEach((p, id) => this.gate(id, p));
  }

  newPeer(id, key) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, key, tr: null, audio: new Audio(), pending: [] };
    peer.audio.autoplay = true;
    pc.onicecandidate = e => { if (e.candidate) this.socket.emit('rtc', { to: id, data: { key, candidate: e.candidate } }); };
    pc.ontrack = e => { peer.audio.srcObject = new MediaStream([e.track]); peer.audio.play().catch(() => {}); };
    this.peers.set(id, peer);
    return peer;
  }

  async call(id, key) {
    const peer = this.newPeer(id, key);
    peer.tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.gate(id, peer);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    this.socket.emit('rtc', { to: id, data: { key, sdp: peer.pc.localDescription } });
  }

  async remote(peer, sdp) {
    await peer.pc.setRemoteDescription(sdp);
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  async onSignal(from, data) {
    try {
      if (data.sdp?.type === 'offer') { // the other side (re)started: answer on a fresh connection
        this.close(from);
        const peer = this.newPeer(from, data.key);
        await this.remote(peer, data.sdp);
        peer.tr = peer.pc.getTransceivers()[0];
        peer.tr.direction = 'sendrecv';
        this.gate(from, peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.socket.emit('rtc', { to: from, data: { key: data.key, sdp: peer.pc.localDescription } });
        return;
      }
      const peer = this.peers.get(from);
      if (!peer || peer.key !== data.key) return; // stale signal from an old connection
      if (data.sdp) await this.remote(peer, data.sdp);
      else if (data.candidate) peer.pc.remoteDescription ? await peer.pc.addIceCandidate(data.candidate) : peer.pending.push(data.candidate);
    } catch (e) { console.warn('voice:', e); }
  }

  gate(id, peer) {
    const a = this.state?.audio;
    if (!a || !peer.tr) return;
    peer.tr.sender.replaceTrack(a.sendTo.includes(id) && this.mic ? this.mic : null).catch(() => {});
    peer.audio.muted = !a.hear.includes(id);
  }

  update(s) {
    this.state = s;
    const me = s.players.find(p => p.id === s.myId);
    const others = s.players.filter(p => p.id !== s.myId && p.connected);
    for (const id of [...this.peers.keys()]) if (!others.some(p => p.id === id)) this.close(id);
    // The smaller id calls; the key changes whenever either side reconnects.
    for (const p of others) {
      if (s.myId > p.id) continue;
      const key = `${me.nonce}-${p.nonce}`;
      if (this.peers.get(p.id)?.key !== key) { this.close(p.id); this.call(p.id, key).catch(e => console.warn('voice:', e)); }
    }
    this.peers.forEach((p, id) => this.gate(id, p));
    if (this.mic) this.status(s.audio.sendTo.length ? '🎤 Seni duyuyorlar' : '🔇 Şu an kimse seni duymuyor');
  }

  close(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
  }

  closeAll() { [...this.peers.keys()].forEach(id => this.close(id)); }
}
