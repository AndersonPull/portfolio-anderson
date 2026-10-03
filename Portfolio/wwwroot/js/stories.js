window.storyPlayer = {
    _video: null,
    _dotnet: null,
    _token: 0,
    _lastProgress: 0,

    attach(video, dotnet) {
        this.detach();
        this._video = video;
        this._dotnet = dotnet;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.controls = false;
    },

    detach() {
        var video = this._video;
        if (!video)
            return;

        this._token += 1;
        video.onended = null;
        video.ontimeupdate = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute("src");
        video.load();
        this._video = null;
        this._dotnet = null;
    },

    setSource(url, muted) {
        var video = this._video;
        var dotnet = this._dotnet;
        if (!video || !dotnet)
            return Promise.resolve(false);

        var token = ++this._token;
        var self = this;
        this._lastProgress = 0;

        video.onended = function () {
            if (token !== self._token)
                return;
            dotnet.invokeMethodAsync("OnEnded");
        };

        video.ontimeupdate = function () {
            if (token !== self._token)
                return;
            var now = Date.now();
            if (now - self._lastProgress < 80)
                return;
            self._lastProgress = now;
            var duration = video.duration;
            if (!duration || !isFinite(duration))
                return;
            dotnet.invokeMethodAsync("OnProgress", video.currentTime / duration, video.currentTime);
        };

        video.onerror = function () {
            if (token !== self._token)
                return;
            if (video.error && video.error.code === 1)
                return;
            dotnet.invokeMethodAsync("OnError");
        };

        video.muted = !!muted;
        video.src = url;

        return video.play().then(function () {
            return token === self._token && !video.muted;
        }).catch(function () {
            if (token !== self._token)
                return false;
            video.muted = true;
            return video.play().then(function () {
                return false;
            }).catch(function () {
                return false;
            });
        });
    },

    setMuted(muted) {
        var video = this._video;
        if (!video)
            return;
        video.muted = !!muted;
        if (!muted)
            video.play().catch(function () { });
    },

    pause() {
        if (this._video)
            this._video.pause();
    },

    resume() {
        var video = this._video;
        if (!video)
            return;
        video.play().catch(function () { });
    },

    restart() {
        var video = this._video;
        if (!video)
            return;
        this._lastProgress = 0;
        try {
            video.currentTime = 0;
        } catch (e) { }
        video.play().catch(function () { });
    },

    capture(el, pointerId) {
        try {
            el.setPointerCapture(pointerId);
        } catch (e) { }
    },

    frameWidth(el) {
        return el.getBoundingClientRect().width;
    }
};
