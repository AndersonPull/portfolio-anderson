window.emoQuestPad = (function () {
    var raf = 0;
    var pressed = {};
    var notify = null;
    var connected = false;
    var inlineSession = null;
    var inlineStarted = false;
    var onPointer = null;
    var root = null;

    function isQuest() {
        var ua = navigator.userAgent || '';
        return /OculusBrowser|Quest|Pacific|HorizonOS|Miramar/i.test(ua);
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

    function buttonDown(buttons, index) {
        var button = buttons && buttons[index];
        return !!(button && (button.pressed || button.value > 0.55));
    }

    function applyDpad(x, y) {
        var dead = 0.45;
        setKey('left', x < -dead);
        setKey('right', x > dead);
        setKey('up', y < -dead);
        setKey('down', y > dead);
    }

    function isQuestPad(pad) {
        if (!pad)
            return false;
        var id = String(pad.id || '').toLowerCase();
        return pad.mapping === 'xr-standard'
            || /oculus|meta|quest|touch|horizon|gear vr/.test(id);
    }

    function applyStandard(pad) {
        var b = pad.buttons || [];
        var a = pad.axes || [];
        applyDpad(a[0] || 0, a[1] || 0);
        if (a.length > 6) {
            setKey('left', buttonDown(b, 14) || a[0] < -0.45);
            setKey('right', buttonDown(b, 15) || a[0] > 0.45);
            setKey('up', buttonDown(b, 12) || a[1] < -0.45);
            setKey('down', buttonDown(b, 13) || a[1] > 0.45);
        }
        setKey('a', buttonDown(b, 0));
        setKey('b', buttonDown(b, 1));
        setKey('x', buttonDown(b, 2));
        setKey('y', buttonDown(b, 3));
        setKey('l', buttonDown(b, 4));
        setKey('r', buttonDown(b, 5));
        setKey('select', buttonDown(b, 8));
        setKey('start', buttonDown(b, 9));
        return true;
    }

    function applyXrStandard(pad, handedness) {
        var b = pad.buttons || [];
        var a = pad.axes || [];
        var trigger = buttonDown(b, 0);
        var squeeze = buttonDown(b, 1);
        var faceA = buttonDown(b, 4);
        var faceB = buttonDown(b, 5);
        var x = a.length > 2 ? a[2] : a[0];
        var y = a.length > 3 ? a[3] : a[1];
        var left = handedness === 'left' || (!handedness && pad.index === 0);

        if (left) {
            applyDpad(x || 0, y || 0);
            setKey('b', trigger);
            setKey('l', squeeze);
            setKey('select', faceA);
            setKey('start', faceB);
            return;
        }

        setKey('a', trigger);
        setKey('r', squeeze);
        setKey('x', faceA);
        setKey('y', faceB);
    }

    function applyPad(pad, handedness) {
        if (!pad || !pad.connected)
            return false;
        if (pad.mapping === 'xr-standard' || isQuestPad(pad))
            applyXrStandard(pad, handedness);
        else if (isQuest() && pad.mapping === 'standard')
            applyStandard(pad);
        else if (isQuest())
            applyXrStandard(pad, handedness);
        else
            return false;
        return true;
    }

    function pollGamepads() {
        if (!navigator.getGamepads)
            return false;
        var pads = navigator.getGamepads();
        var used = false;
        var i;
        var pad;
        var hand;
        for (i = 0; i < pads.length; i++) {
            pad = pads[i];
            if (!pad || !pad.connected)
                continue;
            if (!isQuest() && !isQuestPad(pad))
                continue;
            hand = /left/i.test(pad.id || '') ? 'left'
                : /right/i.test(pad.id || '') ? 'right'
                : (i === 0 ? 'left' : 'right');
            if (pads.length === 1 && pad.mapping === 'standard')
                hand = 'standard';
            if (hand === 'standard')
                used = applyStandard(pad) || used;
            else
                used = applyPad(pad, hand) || used;
        }
        return used;
    }

    function pollInlineSources() {
        if (!inlineSession || !inlineSession.inputSources)
            return false;
        var sources = inlineSession.inputSources;
        var used = false;
        var i;
        var source;
        for (i = 0; i < sources.length; i++) {
            source = sources[i];
            if (source && source.gamepad)
                used = applyPad(source.gamepad, source.handedness) || used;
        }
        return used;
    }

    function setConnected(next) {
        if (connected === next)
            return;
        connected = next;
        if (typeof notify === 'function')
            notify(next);
    }

    function tick() {
        var active = pollGamepads() || pollInlineSources();
        if (!active)
            releaseAll();
        setConnected(active);
        raf = window.requestAnimationFrame(tick);
    }

    function tryInline() {
        if (inlineStarted || !isQuest() || !navigator.xr || !navigator.xr.requestSession)
            return;
        inlineStarted = true;
        navigator.xr.requestSession('inline').then(function (session) {
            inlineSession = session;
            session.addEventListener('end', function () {
                inlineSession = null;
            });
        }).catch(function () {
            // Browser kept Touch as pointer only.
        });
    }

    function start(onChange) {
        stop();
        notify = onChange;
        root = document.getElementById('emo-play-root') || document.body;
        onPointer = function () {
            tryInline();
        };
        root.addEventListener('pointerdown', onPointer, { passive: true });
        raf = window.requestAnimationFrame(tick);
    }

    function stop() {
        if (raf)
            window.cancelAnimationFrame(raf);
        raf = 0;
        if (root && onPointer)
            root.removeEventListener('pointerdown', onPointer);
        onPointer = null;
        root = null;
        if (inlineSession) {
            try { inlineSession.end(); } catch (err) { }
            inlineSession = null;
        }
        inlineStarted = false;
        releaseAll();
        notify = null;
        connected = false;
    }

    return {
        isQuest: isQuest,
        start: start,
        stop: stop
    };
})();
