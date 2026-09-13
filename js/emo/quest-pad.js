window.emoQuestPad = (function () {
    var raf = 0;
    var pressed = {};
    var notify = null;
    var active = false;
    var inlineSession = null;
    var inlineStarted = false;
    var onPointer = null;
    var root = null;

    function isQuest() {
        var ua = navigator.userAgent || '';
        return /OculusBrowser|Oculus|Quest|Pacific|HorizonOS|Miramar|Mobile VR/i.test(ua);
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

    function btn(buttons, index) {
        var button = buttons && buttons[index];
        return !!(button && (button.pressed || button.value > 0.5));
    }

    function axis(axes, index) {
        return (axes && axes.length > index) ? (axes[index] || 0) : 0;
    }

    function padHasInput(pad) {
        if (!pad)
            return false;
        var buttons = pad.buttons || [];
        var axes = pad.axes || [];
        var i;
        for (i = 0; i < buttons.length; i++) {
            if (btn(buttons, i))
                return true;
        }
        for (i = 0; i < axes.length; i++) {
            if (Math.abs(axes[i] || 0) > 0.4)
                return true;
        }
        return false;
    }

    function applyDpad(x, y) {
        var dead = 0.4;
        setKey('left', x < -dead);
        setKey('right', x > dead);
        setKey('up', y < -dead);
        setKey('down', y > dead);
    }

    function stickFrom(pad) {
        var x0 = axis(pad.axes, 0);
        var y0 = axis(pad.axes, 1);
        var x1 = axis(pad.axes, 2);
        var y1 = axis(pad.axes, 3);
        if (Math.abs(x1) + Math.abs(y1) > Math.abs(x0) + Math.abs(y0))
            return { x: x1, y: y1 };
        return { x: x0, y: y0 };
    }

    function applyStandard(pad) {
        var b = pad.buttons || [];
        var stick = stickFrom(pad);
        applyDpad(stick.x, stick.y);
        setKey('up', btn(b, 12) || pressed.up);
        setKey('down', btn(b, 13) || pressed.down);
        setKey('left', btn(b, 14) || pressed.left);
        setKey('right', btn(b, 15) || pressed.right);
        setKey('a', btn(b, 0) || btn(b, 7));
        setKey('b', btn(b, 1) || btn(b, 6));
        setKey('x', btn(b, 2));
        setKey('y', btn(b, 3));
        setKey('l', btn(b, 4));
        setKey('r', btn(b, 5));
        setKey('select', btn(b, 8));
        setKey('start', btn(b, 9) || btn(b, 11));
    }

    function applyXr(pad, handedness, single) {
        var b = pad.buttons || [];
        var stick = stickFrom(pad);
        var trigger = btn(b, 0);
        var squeeze = btn(b, 1);
        var thumb = btn(b, 3);
        var faceA = btn(b, 4);
        var faceB = btn(b, 5);
        var left = handedness === 'left';

        if (single) {
            applyDpad(stick.x, stick.y);
            setKey('a', trigger || faceA);
            setKey('b', squeeze || faceB);
            setKey('x', faceA && !trigger);
            setKey('y', faceB && !squeeze);
            setKey('l', squeeze && left);
            setKey('r', squeeze && !left);
            setKey('start', thumb || btn(b, 2));
            return;
        }

        if (left) {
            applyDpad(stick.x, stick.y);
            setKey('b', trigger);
            setKey('l', squeeze);
            setKey('select', faceA || thumb);
            setKey('start', faceB);
            return;
        }

        setKey('a', trigger);
        setKey('r', squeeze);
        setKey('x', faceA);
        setKey('y', faceB);
        setKey('start', thumb || pressed.start);
    }

    function listPads() {
        var found = [];
        var i;
        var pad;
        if (navigator.getGamepads) {
            var pads = navigator.getGamepads();
            for (i = 0; i < pads.length; i++) {
                pad = pads[i];
                if (pad && pad.connected)
                    found.push({ pad: pad, handedness: guessHand(pad, found.length) });
            }
        }
        if (inlineSession && inlineSession.inputSources) {
            for (i = 0; i < inlineSession.inputSources.length; i++) {
                var source = inlineSession.inputSources[i];
                if (source && source.gamepad)
                    found.push({ pad: source.gamepad, handedness: source.handedness || guessHand(source.gamepad, found.length) });
            }
        }
        return found;
    }

    function guessHand(pad, index) {
        var id = String(pad.id || '');
        if (/left/i.test(id))
            return 'left';
        if (/right/i.test(id))
            return 'right';
        return index === 0 ? 'left' : 'right';
    }

    function poll() {
        var items = listPads();
        var sawInput = false;
        var i;
        var item;
        var single = items.length <= 1;

        for (i = 0; i < items.length; i++) {
            item = items[i];
            if (padHasInput(item.pad))
                sawInput = true;
            if (item.pad.mapping === 'standard' || single)
                applyStandard(item.pad);
            applyXr(item.pad, item.handedness, single);
        }

        if (!sawInput)
            releaseAll();
        return sawInput;
    }

    function setActive(next) {
        if (active === next)
            return;
        active = next;
        if (typeof notify === 'function')
            notify(next);
    }

    function tick() {
        setActive(poll());
        raf = window.requestAnimationFrame(tick);
    }

    function tryInline() {
        if (inlineStarted || !navigator.xr || !navigator.xr.requestSession)
            return;
        inlineStarted = true;
        navigator.xr.requestSession('inline').then(function (session) {
            inlineSession = session;
            session.addEventListener('end', function () {
                inlineSession = null;
            });
        }).catch(function () {});
    }

    function start(onChange) {
        stop();
        notify = onChange;
        root = document.getElementById('emo-play-root') || document.body;
        onPointer = function () {
            tryInline();
            if (navigator.getGamepads)
                navigator.getGamepads();
        };
        root.addEventListener('pointerdown', onPointer, { passive: true });
        if (isQuest())
            tryInline();
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
        active = false;
    }

    return {
        isQuest: isQuest,
        isActive: function () { return active; },
        start: start,
        stop: stop
    };
})();
