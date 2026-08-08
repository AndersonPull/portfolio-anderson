window.emoEmulator = {
    instance: null,
    targetElement: null,

    async init(elementId, romUrl, core) {
        await this.stop();

        const canvas = document.getElementById(elementId);
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error(`Canvas #${elementId} not found`);
        }

        if (typeof Nostalgist === 'undefined') {
            throw new Error('Nostalgist library not loaded');
        }

        this.targetElement = canvas;

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

    async stop() {
        if (this.instance) {
            try {
                await this.instance.exit();
            } catch (error) {
                console.warn('emoEmulator.stop:', error);
            }

            this.instance = null;
        }

        this.targetElement = null;

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
