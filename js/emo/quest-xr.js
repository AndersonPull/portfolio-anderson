window.emoQuestXr = (function () {
    var session = null;
    var renderer = null;
    var scene = null;
    var camera = null;
    var texture = null;
    var plane = null;
    var frameMesh = null;
    var xrCanvas = null;
    var blitCanvas = null;
    var blitCtx = null;
    var gameCanvas = null;
    var pressed = {};
    var dotNet = null;
    var onSessionEnd = null;
    var threePromise = null;
    var entering = false;

    function isXrCanvas(canvas) {
        return !!(canvas && canvas.getAttribute && canvas.getAttribute('data-emo-xr') === '1');
    }

    function resolveCanvas(canvasId) {
        var hinted = window.emoEmulator && window.emoEmulator.targetElement;
        var root = hinted instanceof HTMLElement ? hinted.parentElement : null;
        var nodes = (root || document).querySelectorAll('canvas');
        var i;
        var canvas;
        for (i = 0; i < nodes.length; i++) {
            canvas = nodes[i];
            if (isXrCanvas(canvas))
                continue;
            if ((canvas.width > 8 && canvas.height > 8) || canvas.clientWidth > 8)
                return canvas;
        }
        if (hinted instanceof HTMLCanvasElement && !isXrCanvas(hinted))
            return hinted;
        var el = document.getElementById(canvasId);
        if (el instanceof HTMLCanvasElement && !isXrCanvas(el))
            return el;
        return el && el.querySelector ? el.querySelector('canvas') : null;
    }

    function syncBlit() {
        if (!gameCanvas || !blitCtx)
            return;
        var w = Math.max(gameCanvas.width || 0, 320);
        var h = Math.max(gameCanvas.height || 0, 240);
        if (blitCanvas.width !== w)
            blitCanvas.width = w;
        if (blitCanvas.height !== h)
            blitCanvas.height = h;
        try {
            blitCtx.drawImage(gameCanvas, 0, 0, w, h);
        } catch (err) {
            // Cross-origin or empty WebGL buffer.
        }
    }

    function preloadThree() {
        if (!threePromise)
            threePromise = import('three');
        return threePromise;
    }

    function flashStatus(text) {
        var el = document.getElementById('emo-xr-status');
        if (!el) {
            el = document.createElement('span');
            el.id = 'emo-xr-status';
            el.className = 'emo-xr-status';
            var bar = document.querySelector('.emo-top-right');
            if (bar)
                bar.insertBefore(el, bar.firstChild);
            else
                return;
        }
        el.textContent = text || '';
        el.hidden = !text;
    }

    function setKey(code, down) {
        var next = !!down;
        if (!!pressed[code] === next)
            return;
        pressed[code] = next;
        if (window.emoEmulator)
            window.emoEmulator.simulateKey(code, next);
    }

    function releaseAll() {
        Object.keys(pressed).forEach(function (code) {
            if (pressed[code])
                setKey(code, false);
        });
    }

    function buttonDown(pad, index) {
        var button = pad.buttons && pad.buttons[index];
        return !!(button && (button.pressed || button.value > 0.6));
    }

    function stickAxis(pad, index, fallback) {
        if (pad.axes && pad.axes.length > index)
            return pad.axes[index] || 0;
        if (pad.axes && pad.axes.length > fallback)
            return pad.axes[fallback] || 0;
        return 0;
    }

    function applyDpad(x, y) {
        var dead = 0.45;
        setKey('left', x < -dead);
        setKey('right', x > dead);
        setKey('up', y < -dead);
        setKey('down', y > dead);
    }

    function applySource(source, hasLeft) {
        var pad = source.gamepad;
        if (!pad)
            return;

        var left = source.handedness === 'left';
        var right = source.handedness === 'right';
        var trigger = buttonDown(pad, 0);
        var squeeze = buttonDown(pad, 1);
        var facePrimary = buttonDown(pad, 4);
        var faceSecondary = buttonDown(pad, 5);
        var x = stickAxis(pad, 2, 0);
        var y = stickAxis(pad, 3, 1);

        if (left || (!hasLeft && !right)) {
            applyDpad(x, y);
            setKey('b', trigger);
            setKey('l', squeeze);
            setKey('select', facePrimary);
            setKey('start', faceSecondary);
            return;
        }

        setKey('a', trigger);
        setKey('r', squeeze);
        setKey('x', facePrimary);
        setKey('y', faceSecondary);
    }

    function pollInputs(xrSession) {
        var sources = xrSession.inputSources || [];
        var hasLeft = false;
        for (var i = 0; i < sources.length; i++) {
            if (sources[i].handedness === 'left')
                hasLeft = true;
        }
        for (var j = 0; j < sources.length; j++)
            applySource(sources[j], hasLeft);
    }

    function notify(active) {
        if (!dotNet)
            return;
        dotNet.invokeMethodAsync('OnXrChanged', active).catch(function () {});
    }

    function disposeScene() {
        if (renderer)
            renderer.setAnimationLoop(null);

        [plane, frameMesh].forEach(function (mesh) {
            if (!mesh)
                return;
            if (mesh.geometry)
                mesh.geometry.dispose();
            if (mesh.material) {
                if (mesh.material.map)
                    mesh.material.map.dispose();
                mesh.material.dispose();
            }
        });

        if (renderer)
            renderer.dispose();

        if (xrCanvas && xrCanvas.parentNode)
            xrCanvas.parentNode.removeChild(xrCanvas);

        renderer = null;
        scene = null;
        camera = null;
        texture = null;
        plane = null;
        frameMesh = null;
        xrCanvas = null;
        blitCanvas = null;
        blitCtx = null;
        gameCanvas = null;
    }

    function teardown(fromEndEvent) {
        entering = false;
        releaseAll();
        if (session && onSessionEnd)
            session.removeEventListener('end', onSessionEnd);
        onSessionEnd = null;

        var current = session;
        session = null;
        disposeScene();

        if (current && !fromEndEvent) {
            try {
                current.end();
            } catch (err) {
                console.warn('emoQuestXr.end:', err);
            }
        }

        notify(false);
    }

    function bind(dotNetRef) {
        dotNet = dotNetRef;
        preloadThree();
    }

    async function isSupported() {
        if (!navigator.xr || !navigator.xr.isSessionSupported)
            return false;
        try {
            var ok = await navigator.xr.isSessionSupported('immersive-vr');
            if (ok)
                preloadThree();
            return ok;
        } catch (err) {
            return false;
        }
    }

    function enter(canvasId) {
        if (session || entering)
            return false;

        if (!navigator.xr || !navigator.xr.requestSession) {
            flashStatus('WebXR indisponível');
            return false;
        }

        entering = true;
        flashStatus('');

        // Must run in the same tap. Do not await anything before this.
        var sessionPromise = navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor']
        });

        sessionPromise.then(function (xrSession) {
            return finishEnter(xrSession, canvasId).catch(function (err) {
                try { xrSession.end(); } catch (endErr) { }
                throw err;
            });
        }).catch(function (err) {
            entering = false;
            console.error('emoQuestXr.enter:', err);
            flashStatus(err && err.message ? err.message : 'Falha ao entrar em VR');
        });

        return false;
    }

    async function finishEnter(xrSession, canvasId) {
        gameCanvas = resolveCanvas(canvasId || 'emo-canvas');
        if (!(gameCanvas instanceof HTMLCanvasElement))
            throw new Error('Canvas do jogo não encontrado');

        if (gameCanvas.width < 64 || gameCanvas.height < 64) {
            gameCanvas.width = 960;
            gameCanvas.height = 720;
        }

        blitCanvas = document.createElement('canvas');
        blitCtx = blitCanvas.getContext('2d', { alpha: false });
        syncBlit();

        var THREE = await preloadThree();

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.xr.enabled = true;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        xrCanvas = renderer.domElement;
        xrCanvas.setAttribute('data-emo-xr', '1');
        document.body.appendChild(xrCanvas);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);
        camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);

        texture = new THREE.CanvasTexture(blitCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = true;

        frameMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.68, 1.28),
            new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
        );
        frameMesh.position.set(0, 0, -2.02);

        plane = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 1.2),
            new THREE.MeshBasicMaterial({ map: texture })
        );
        plane.position.set(0, 0, -2);
        camera.add(frameMesh);
        camera.add(plane);
        scene.add(camera);

        session = xrSession;
        onSessionEnd = function () {
            teardown(true);
        };
        session.addEventListener('end', onSessionEnd);
        await renderer.xr.setSession(session);

        renderer.setAnimationLoop(function (_time, frame) {
            syncBlit();
            if (texture)
                texture.needsUpdate = true;
            if (frame && session)
                pollInputs(session);
            if (renderer && scene && camera)
                renderer.render(scene, camera);
        });

        entering = false;
        flashStatus('');
        notify(true);
        return true;
    }

    async function exit() {
        if (!session) {
            entering = false;
            disposeScene();
            releaseAll();
            return;
        }
        teardown(false);
    }

    return {
        isSupported: isSupported,
        bind: bind,
        enter: enter,
        exit: exit
    };
})();
