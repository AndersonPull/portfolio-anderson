window.emoQuestXr = (function () {
    var session = null;
    var renderer = null;
    var scene = null;
    var camera = null;
    var texture = null;
    var plane = null;
    var xrCanvas = null;
    var pressed = {};
    var dotNet = null;
    var onSessionEnd = null;

    function resolveCanvas(canvasId) {
        var el = document.getElementById(canvasId);
        if (!el)
            return null;
        if (el instanceof HTMLCanvasElement)
            return el;
        return el.querySelector ? el.querySelector('canvas') : null;
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

        if (plane) {
            if (plane.geometry)
                plane.geometry.dispose();
            if (plane.material) {
                if (plane.material.map)
                    plane.material.map.dispose();
                plane.material.dispose();
            }
        }

        if (renderer)
            renderer.dispose();

        if (xrCanvas && xrCanvas.parentNode)
            xrCanvas.parentNode.removeChild(xrCanvas);

        renderer = null;
        scene = null;
        camera = null;
        texture = null;
        plane = null;
        xrCanvas = null;
    }

    function teardown(fromEndEvent) {
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
        dotNet = null;
    }

    async function isSupported() {
        if (!navigator.xr || !navigator.xr.isSessionSupported)
            return false;
        try {
            return await navigator.xr.isSessionSupported('immersive-vr');
        } catch (err) {
            return false;
        }
    }

    async function enter(canvasId, dotNetRef) {
        if (session)
            return true;

        var supported = await isSupported();
        if (!supported)
            throw new Error('WebXR não suportado');

        var gameCanvas = resolveCanvas(canvasId);
        if (!(gameCanvas instanceof HTMLCanvasElement))
            throw new Error('Canvas do jogo não encontrado');

        dotNet = dotNetRef;
        var THREE = await import('three');

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.xr.enabled = true;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        xrCanvas = renderer.domElement;
        xrCanvas.setAttribute('data-emo-xr', '1');
        document.body.appendChild(xrCanvas);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050505);
        camera = new THREE.PerspectiveCamera(70, 1, 0.05, 50);

        texture = new THREE.CanvasTexture(gameCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;

        plane = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 1.2),
            new THREE.MeshBasicMaterial({ map: texture })
        );
        plane.position.set(0, 1.35, -2.15);
        scene.add(plane);

        session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor']
        });

        onSessionEnd = function () {
            teardown(true);
        };
        session.addEventListener('end', onSessionEnd);
        await renderer.xr.setSession(session);

        renderer.setAnimationLoop(function (_time, frame) {
            if (texture)
                texture.needsUpdate = true;
            if (frame && session)
                pollInputs(session);
            if (renderer && scene && camera)
                renderer.render(scene, camera);
        });

        notify(true);
        return true;
    }

    async function exit() {
        if (!session) {
            disposeScene();
            releaseAll();
            return;
        }
        teardown(false);
    }

    return {
        isSupported: isSupported,
        enter: enter,
        exit: exit
    };
})();
