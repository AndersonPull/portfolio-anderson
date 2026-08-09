window.emoEmulator = {
    instance: null,
    targetElement: null,
    volume: 10,
    _volumeTimer: null,
    _audioContexts: [],
    _nativeAudioContext: null,
    _nativeWebkitAudioContext: null,
    _gamepadWatchId: null,
    _gamepadDotNet: null,
    _gamepadConnected: false,
    _onGamepadConnected: null,
    _onGamepadDisconnected: null,

    readStoredVolume() {
        const raw = localStorage.getItem('emo.volume');
        const parsed = Number.parseInt(raw ?? '10', 10);
        if (Number.isNaN(parsed)) {
            return 10;
        }

        return Math.min(10, Math.max(0, parsed));
    },

    installAudioHook() {
        if (this._nativeAudioContext || this._nativeWebkitAudioContext) {
            return;
        }

        const self = this;

        const patch = (globalName) => {
            const Native = window[globalName];
            if (typeof Native !== 'function') {
                return null;
            }

            if (globalName === 'AudioContext') {
                this._nativeAudioContext = Native;
            } else {
                this._nativeWebkitAudioContext = Native;
            }

            window[globalName] = new Proxy(Native, {
                construct(target, args) {
                    const ctx = Reflect.construct(target, args);
                    self.registerAudioContext(ctx);
                    return ctx;
                }
            });

            return Native;
        };

        patch('AudioContext');
        patch('webkitAudioContext');
    },

    registerAudioContext(ctx) {
        if (!ctx || ctx.__emoMasterGain) {
            return;
        }

        try {
            const realDestination = ctx.destination;
            const master = ctx.createGain();
            master.gain.value = this.volume / 10;
            master.connect(realDestination);
            ctx.__emoMasterGain = master;
            ctx.__emoRealDestination = realDestination;

            Object.defineProperty(ctx, 'destination', {
                configurable: true,
                enumerable: true,
                get() {
                    return master;
                }
            });

            this._audioContexts.push(ctx);
        } catch (error) {
            console.warn('emoEmulator.registerAudioContext:', error);
        }
    },

    async ensureNostalgist() {
        if (typeof Nostalgist !== 'undefined') {
            return;
        }

        await new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-emo-nostalgist]');
            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('Falha ao carregar Nostalgist')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/nostalgist/dist/nostalgist.umd.js';
            script.async = true;
            script.dataset.emoNostalgist = 'true';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Falha ao carregar Nostalgist'));
            document.head.appendChild(script);
        });

        if (typeof Nostalgist === 'undefined') {
            throw new Error('Nostalgist library not loaded');
        }
    },

    async init(elementId, romUrl, core) {
        await this.stop();
        await this.ensureNostalgist();

        const canvas = document.getElementById(elementId);
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error(`Canvas #${elementId} not found`);
        }

        this.targetElement = canvas;
        this.volume = this.readStoredVolume();
        this.installAudioHook();

        Nostalgist.configure({
            style: {
                width: '100%',
                height: '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                aspectRatio: '4 / 3',
                display: 'block',
                position: 'relative',
                inset: 'unset'
            }
        });

        this.instance = await Nostalgist.launch({
            core: core,
            rom: romUrl,
            element: canvas,
            respondToGlobalEvents: true,
            retroarchConfig: {
                input_player1_up: 'up',
                input_player1_down: 'down',
                input_player1_left: 'left',
                input_player1_right: 'right',
                input_player1_a: 'x',
                input_player1_b: 'z',
                input_player1_x: 's',
                input_player1_y: 'a',
                input_player1_l: 'q',
                input_player1_r: 'w',
                input_player1_select: 'rshift',
                input_player1_start: 'enter'
            }
        });

        this.captureExistingAudioContexts();
        this.applyVolume();
        this.startVolumeWatch();
        return true;
    },

    simulateKey(button, pressed) {
        if (!this.instance) {
            return;
        }

        if (pressed) {
            this.instance.pressDown(button);
        } else {
            this.instance.pressUp(button);
        }
    },

    pause() {
        if (!this.instance) {
            return;
        }

        try {
            this.instance.pause();
        } catch (error) {
            console.warn('emoEmulator.pause:', error);
        }
    },

    resume() {
        if (!this.instance) {
            return;
        }

        try {
            this.instance.resume();
            this.applyVolume();
        } catch (error) {
            console.warn('emoEmulator.resume:', error);
        }
    },

    volumeToGain(level) {
        return Math.min(10, Math.max(0, level)) / 10;
    },

    getVolume() {
        return this.volume;
    },

    setVolume(level) {
        const parsed = Number.parseInt(level, 10);
        this.volume = Number.isNaN(parsed) ? 10 : Math.min(10, Math.max(0, parsed));
        localStorage.setItem('emo.volume', String(this.volume));
        this.applyVolume();
        return this.volume;
    },

    getAlObject() {
        if (!this.instance) {
            return null;
        }

        try {
            const al = this.instance.getEmscriptenAL?.();
            if (al) {
                return al;
            }
        } catch {
            // ignore
        }

        try {
            return this.instance.getEmscriptenModule?.()?.AL
                ?? this.instance.getEmscripten?.()?.AL
                ?? null;
        } catch {
            return null;
        }
    },

    captureExistingAudioContexts() {
        const al = this.getAlObject();
        if (!al) {
            return;
        }

        const candidates = [];
        if (al.currentCtx?.ctx) {
            candidates.push(al.currentCtx.ctx);
        }

        if (al.contexts) {
            for (const entry of Object.values(al.contexts)) {
                if (entry?.ctx) {
                    candidates.push(entry.ctx);
                }
            }
        }

        for (const ctx of candidates) {
            this.registerAudioContext(ctx);
        }
    },

    applyAlSourceGains(gainValue) {
        const al = this.getAlObject();
        if (!al) {
            return false;
        }

        let applied = false;
        const contexts = [];

        if (al.currentCtx) {
            contexts.push(al.currentCtx);
        }

        if (al.contexts) {
            for (const entry of Object.values(al.contexts)) {
                if (entry) {
                    contexts.push(entry);
                }
            }
        }

        for (const ctx of contexts) {
            if (ctx.gain?.gain) {
                ctx.gain.gain.value = gainValue;
                applied = true;
            }

            const sources = ctx.sources;
            if (!sources) {
                continue;
            }

            const list = Array.isArray(sources) ? sources : Object.values(sources);
            for (const source of list) {
                if (source?.gain?.gain) {
                    source.gain.gain.value = gainValue;
                    applied = true;
                }
            }

            if (ctx.ctx && typeof ctx.ctx.resume === 'function' && ctx.ctx.state === 'suspended' && gainValue > 0) {
                ctx.ctx.resume().catch(() => {});
            }
        }

        return applied;
    },

    applyVolume() {
        const gainValue = this.volumeToGain(this.volume);
        let applied = false;

        this.captureExistingAudioContexts();

        for (const ctx of this._audioContexts) {
            if (ctx.__emoMasterGain?.gain) {
                ctx.__emoMasterGain.gain.value = gainValue;
                applied = true;
            }

            if (ctx.state === 'suspended' && gainValue > 0 && typeof ctx.resume === 'function') {
                ctx.resume().catch(() => {});
            }
        }

        if (this.applyAlSourceGains(gainValue)) {
            applied = true;
        }

        return applied;
    },

    startVolumeWatch() {
        this.stopVolumeWatch();

        let attempts = 0;
        this._volumeTimer = window.setInterval(() => {
            attempts += 1;
            const applied = this.applyVolume();
            if (applied && attempts >= 8) {
                this.stopVolumeWatch();
                this._volumeTimer = window.setInterval(() => this.applyVolume(), 1500);
            } else if (attempts >= 60) {
                this.stopVolumeWatch();
                this._volumeTimer = window.setInterval(() => this.applyVolume(), 1500);
            }
        }, 200);
    },

    stopVolumeWatch() {
        if (this._volumeTimer != null) {
            window.clearInterval(this._volumeTimer);
            this._volumeTimer = null;
        }
    },

    async blobToBase64(blob) {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;

        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }

        return btoa(binary);
    },

    base64ToBlob(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new Blob([bytes]);
    },

    async exportState(meta) {
        if (!this.instance) {
            throw new Error('Emulador não iniciado');
        }

        const gameId = meta?.gameId;
        const core = meta?.core;
        if (!gameId || !core) {
            throw new Error('Metadados do jogo incompletos');
        }

        const { state } = await this.instance.saveState();
        const stateBase64 = await this.blobToBase64(state);
        const payload = {
            version: 1,
            gameId,
            core,
            savedAt: new Date().toISOString(),
            stateBase64
        };

        const stamp = payload.savedAt.replace(/[:.]/g, '-');
        const filename = `${gameId}-${stamp}.emo-state.json`;
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);

        return { ok: true, filename };
    },

    async importState(file, meta) {
        if (!(file instanceof Blob)) {
            throw new Error('Arquivo inválido');
        }

        const text = await file.text();
        return this.importStateFromText(text, meta);
    },

    async importStateFromBytes(bytes, meta) {
        const text = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        return this.importStateFromText(text, meta);
    },

    async importStateFromText(text, meta) {
        if (!this.instance) {
            throw new Error('Emulador não iniciado');
        }

        const gameId = meta?.gameId;
        const core = meta?.core;
        if (!gameId || !core) {
            throw new Error('Metadados do jogo incompletos');
        }

        let payload;

        try {
            payload = JSON.parse(text);
        } catch {
            throw new Error('Arquivo de estado inválido');
        }

        if (payload?.version !== 1 || typeof payload.stateBase64 !== 'string') {
            throw new Error('Arquivo de estado inválido');
        }

        if (payload.gameId !== gameId || payload.core !== core) {
            throw new Error('Jogo incompatível');
        }

        const stateBlob = this.base64ToBlob(payload.stateBase64);
        await this.instance.loadState(stateBlob);
        return { ok: true };
    },

    clickElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.click();
        }
    },

    hasActiveGamepad() {
        if (!navigator.getGamepads) {
            return false;
        }

        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) {
            const pad = pads[i];
            if (pad && pad.connected) {
                return true;
            }
        }

        return false;
    },

    startGamepadWatch(dotNetRef) {
        this.stopGamepadWatch();
        this._gamepadDotNet = dotNetRef;
        this._gamepadConnected = false;

        const notify = () => {
            const connected = this.hasActiveGamepad();
            if (connected === this._gamepadConnected) {
                return;
            }

            this._gamepadConnected = connected;
            if (this._gamepadDotNet) {
                this._gamepadDotNet.invokeMethodAsync('OnGamepadChanged', connected).catch(() => {});
            }
        };

        this._onGamepadConnected = () => notify();
        this._onGamepadDisconnected = () => {
            // Give the browser a tick to update getGamepads().
            window.setTimeout(notify, 50);
        };

        window.addEventListener('gamepadconnected', this._onGamepadConnected);
        window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
        this._gamepadWatchId = window.setInterval(notify, 400);
        notify();
    },

    stopGamepadWatch() {
        if (this._gamepadWatchId != null) {
            window.clearInterval(this._gamepadWatchId);
            this._gamepadWatchId = null;
        }

        if (this._onGamepadConnected) {
            window.removeEventListener('gamepadconnected', this._onGamepadConnected);
            this._onGamepadConnected = null;
        }

        if (this._onGamepadDisconnected) {
            window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
            this._onGamepadDisconnected = null;
        }

        this._gamepadDotNet = null;
        this._gamepadConnected = false;
    },

    async stop() {
        this.stopVolumeWatch();
        this.stopGamepadWatch();

        if (this.instance) {
            try {
                await this.instance.exit();
            } catch (error) {
                console.warn('emoEmulator.stop:', error);
            }

            this.instance = null;
        }

        this.targetElement = null;
        this._audioContexts = [];

        if (typeof Nostalgist !== 'undefined') {
            Nostalgist.resetToDefault();
        }
    },

    resize() {
        window.dispatchEvent(new Event('resize'));
    },

    async enterFullscreen(elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            return false;
        }

        try {
            if (element.requestFullscreen) {
                try {
                    await element.requestFullscreen({ navigationUI: 'hide' });
                } catch {
                    await element.requestFullscreen();
                }
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen();
            } else if (element.mozRequestFullScreen) {
                element.mozRequestFullScreen();
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
            } else {
                window.alert('Este navegador não permite tela cheia. Adicione o site à tela inicial para abrir como aplicativo.');
                return false;
            }

            if (screen.orientation?.lock) {
                await screen.orientation.lock('landscape').catch(() => {});
            }

            window.scrollTo(0, 1);
            this.resize();
            return true;
        } catch (error) {
            console.warn('emoEmulator.enterFullscreen:', error);
            window.alert('Não foi possível entrar em tela cheia neste navegador.');
            return false;
        }
    }
};

window.emoEmulator.volume = window.emoEmulator.readStoredVolume();
window.emoEmulator.installAudioHook();
