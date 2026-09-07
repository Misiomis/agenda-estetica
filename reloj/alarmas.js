// Solo se guardan identificadores de avisos y su hora, nunca fichas de pacientes.
// IndexedDB serializa las transacciones readwrite entre pestañas del mismo origen.
export class AlarmLedger {
  constructor(scope, indexedDB = globalThis.indexedDB) {
    this.scope = scope;
    this.factory = indexedDB;
    this.db = null;
  }
  open() {
    if (this.db) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      if (!this.factory) return reject(new Error("local-storage-unavailable"));
      const request = this.factory.open("mimar-reloj-avisos-v1", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("avisos", { keyPath: "id" });
        store.createIndex("at", "at");
      };
      request.onerror = () => reject(new Error("local-storage-unavailable"));
      request.onblocked = () => reject(new Error("local-storage-blocked"));
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => { this.db.close(); this.db = null; };
        resolve(this);
      };
    });
  }
  claim(key, now = Date.now()) {
    if (!this.db) return Promise.reject(new Error("local-storage-unavailable"));
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction("avisos", "readwrite");
      const store = transaction.objectStore("avisos");
      const id = this.scope + ":" + key;
      let claimed = false;
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) return;
        store.add({ id, at: now });
        claimed = true;
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => reject(new Error("local-storage-write-failed"));
      transaction.onabort = () => reject(new Error("local-storage-write-failed"));
    });
  }
  prune(now = Date.now()) {
    if (!this.db) return;
    const transaction = this.db.transaction("avisos", "readwrite");
    const index = transaction.objectStore("avisos").index("at");
    const cursor = index.openCursor(IDBKeyRange.upperBound(now - 7 * 86400_000));
    cursor.onsuccess = () => {
      if (cursor.result) { cursor.result.delete(); cursor.result.continue(); }
    };
  }
}

export class Chime {
  constructor() { this.context = null; this.playing = new Set(); }
  async unlock() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw new Error("audio-unavailable");
    if (!this.context || this.context.state === "closed") {
      this.context = new Context();
      this.context.onstatechange = () => this.onStateChange?.();
    }
    if (this.context.state === "suspended") await this.context.resume();
    if (this.context.state !== "running") throw new Error("audio-blocked");
  }
  play(prefs, repeats = 1) {
    if (!this.context || this.context.state !== "running") return false;
    const notes = prefs.tone === "cristal" ? [880, 1174.66, 1318.51]
      : prefs.tone === "doble" ? [587.33, 783.99] : [659.25, 880];
    const volume = Math.max(0, Math.min(1, prefs.volume));
    if (volume === 0) return true;
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (let i = 0; i < notes.length; i++) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const start = this.context.currentTime + repeat * 1.65 + i * .22;
        oscillator.type = "sine";
        oscillator.frequency.value = notes[i];
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume * volume * .22, start + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .9);
        gain.gain.setValueAtTime(0, start + 1);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        this.playing.add(oscillator);
        oscillator.onended = () => {
          this.playing.delete(oscillator); oscillator.disconnect(); gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 1.05);
      }
    }
    return true;
  }
  stop() {
    for (const oscillator of this.playing) {
      try { oscillator.stop(); } catch { /* Ya finalizado. */ }
    }
    this.playing.clear();
  }
}
