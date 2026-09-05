window.lojaViewer = (function () {
    var viewers = [];
    var mountGen = 0;
    var gltfCache = {};
    var loaderPromise = null;
    var mountChain = Promise.resolve();
    var visibilityBound = false;

    function sizeOf(canvas) {
        var rect = canvas.getBoundingClientRect();
        return {
            cssWidth: Math.max(1, rect.width),
            cssHeight: Math.max(1, rect.height)
        };
    }

    function isCompact() {
        var width = window.innerWidth || document.documentElement.clientWidth || 9999;
        var phone = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        return width <= 700 || (phone && width <= 1024);
    }

    function resolveModelUrl(url) {
        if (!url || !isCompact())
            return url;
        if (/-lite\.glb$/i.test(url))
            return url;
        return String(url).replace(/\.glb$/i, '-lite.glb');
    }

    function qualityProfile(preview) {
        var compact = isCompact();
        return {
            compact: compact,
            powerPreference: compact ? 'low-power' : 'high-performance',
            antialias: !compact && !preview,
            dprCap: compact ? 1 : (preview ? 1 : 1.25),
            fps: compact ? 22 : (preview ? 30 : 30)
        };
    }

    function worldBox(obj, THREE) {
        obj.updateMatrixWorld(true);
        var box = new THREE.Box3();
        obj.traverse(function (child) {
            if (child.isMesh)
                box.expandByObject(child);
        });
        if (box.isEmpty())
            box.setFromObject(obj);
        return box;
    }

    function boxSize(root, THREE) {
        return worldBox(root, THREE).getSize(new THREE.Vector3());
    }

    async function getLoader() {
        if (loaderPromise)
            return loaderPromise;
        loaderPromise = (async function () {
            var THREE = await import('three');
            var addons = await import('three/addons/loaders/GLTFLoader.js');
            var controlsMod = await import('three/addons/controls/OrbitControls.js');
            var dracoMod = await import('three/addons/loaders/DRACOLoader.js');
            var loader = new addons.GLTFLoader();
            var draco = new dracoMod.DRACOLoader();
            draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
            loader.setDRACOLoader(draco);
            return { THREE: THREE, loader: loader, controlsMod: controlsMod };
        })();
        return loaderPromise;
    }

    function loadGltf(modelUrl) {
        if (!gltfCache[modelUrl]) {
            gltfCache[modelUrl] = getLoader().then(function (deps) {
                return deps.loader.loadAsync(modelUrl);
            }).catch(function (err) {
                delete gltfCache[modelUrl];
                console.error('lojaViewer load:', modelUrl, err);
                throw err;
            });
        }
        return gltfCache[modelUrl];
    }

    function preload() {
        var urls = Array.prototype.slice.call(arguments);
        if (urls.length === 1 && Array.isArray(urls[0]))
            urls = urls[0];
        urls.forEach(function (url) {
            if (url)
                loadGltf(resolveModelUrl(url));
        });
    }

    function preloadListing() {
        if (isCompact()) {
            preload('3dModels/Cartucho.glb', '3dModels/MobileController.glb');
            return;
        }
        preload('3dModels/MobileController.glb');
    }

    function prepareRoot(gltfScene, THREE) {
        var root = new THREE.Group();
        var model = gltfScene.clone(true);
        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = false;
                obj.receiveShadow = false;
                obj.frustumCulled = false;
                var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(function (m) {
                    if (m)
                        m.side = THREE.DoubleSide;
                });
            }
        });
        model.updateMatrixWorld(true);
        var box = new THREE.Box3();
        model.traverse(function (obj) {
            if (obj.isMesh)
                box.expandByObject(obj);
        });
        if (box.isEmpty())
            box.setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        root.add(model);
        root.updateMatrixWorld(true);
        return root;
    }

    function onVisibilityChange() {
        viewers.forEach(syncPause);
    }

    function bindVisibility() {
        if (visibilityBound)
            return;
        visibilityBound = true;
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    function unbindVisibilityIfIdle() {
        if (viewers.length || !visibilityBound)
            return;
        document.removeEventListener('visibilitychange', onVisibilityChange);
        visibilityBound = false;
    }

    function syncPause(entry) {
        if (!entry)
            return;
        var shouldPause = document.hidden || entry.visible === false;
        if (shouldPause === entry.paused)
            return;
        entry.paused = shouldPause;
        if (shouldPause) {
            cancelAnimationFrame(entry.raf);
            entry.raf = 0;
            return;
        }
        entry.lastDraw = 0;
        entry.tick(performance.now());
    }

    function disposeOne(entry) {
        if (!entry)
            return;
        cancelAnimationFrame(entry.raf);
        entry.raf = 0;
        entry.paused = true;
        entry.intersectObserver && entry.intersectObserver.disconnect();
        entry.resizeObserver && entry.resizeObserver.disconnect();
        window.removeEventListener('resize', entry.onResize);
        if (entry.onPointer)
            entry.canvas && entry.canvas.removeEventListener('pointerdown', entry.onPointer);
        entry.controls && entry.controls.dispose();
        if (entry.renderer)
            entry.renderer.dispose();
    }

    function disposeAll() {
        viewers.forEach(disposeOne);
        viewers = [];
        unbindVisibilityIfIdle();
    }

    function dispose(canvas) {
        if (!canvas) {
            mountGen++;
            disposeAll();
            return;
        }
        viewers = viewers.filter(function (entry) {
            if (entry.canvas !== canvas)
                return true;
            disposeOne(entry);
            return false;
        });
        unbindVisibilityIfIdle();
    }

    function mount(canvas, modelUrl, kind, preview) {
        var job = function () {
            return mountNow(canvas, modelUrl, kind, preview);
        };
        mountChain = mountChain.then(job, job);
        return mountChain;
    }

    async function mountNow(canvas, modelUrl, kind, preview) {
        if (!canvas)
            return;

        var resolvedUrl = resolveModelUrl(modelUrl);
        var profile = qualityProfile(preview);

        var gen = mountGen;
        if (!preview) {
            gen = ++mountGen;
            disposeAll();
        } else {
            dispose(canvas);
        }

        var deps = await getLoader();
        var gltf = await loadGltf(resolvedUrl);
        if (gen !== mountGen)
            return;

        if (!preview)
            disposeAll();

        var THREE = deps.THREE;
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(preview ? 0xf3f3f3 : 0xe2e2e2);

        var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
        var renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: profile.antialias,
            alpha: false,
            powerPreference: profile.powerPreference
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = false;

        var controls = new deps.controlsMod.OrbitControls(camera, canvas);
        controls.enableDamping = !preview && !profile.compact;
        controls.dampingFactor = 0.08;
        controls.autoRotate = !!preview;
        controls.autoRotateSpeed = 1.4;
        controls.enableRotate = !preview;
        controls.enableZoom = false;
        controls.enablePan = false;
        controls.rotateSpeed = 0.85;

        scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.25));
        var key = new THREE.DirectionalLight(0xffffff, 1.2);
        key.position.set(2, 4, 6);
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.45);
        fill.position.set(-3, 1, 2);
        scene.add(fill);

        var root = prepareRoot(gltf.scene, THREE);
        if (kind === 'controle')
            root.rotation.set(-0.22, 0.55, 0);
        else
            root.rotation.set(-0.18, 0.42, 0.04);
        root.updateMatrixWorld(true);

        var size0 = boxSize(root, THREE);
        var maxDim = Math.max(size0.x, size0.y, size0.z, 0.0001);
        root.scale.setScalar(1 / maxDim);
        root.updateMatrixWorld(true);
        var mid = worldBox(root, THREE).getCenter(new THREE.Vector3());
        root.position.sub(mid);
        root.updateMatrixWorld(true);
        scene.add(root);

        var entry = {
            canvas: canvas,
            renderer: renderer,
            controls: controls,
            raf: 0,
            lastDraw: 0,
            paused: false,
            visible: true,
            interacting: false,
            userMoved: false,
            resizeObserver: null,
            intersectObserver: null,
            onResize: null,
            onPointer: null,
            tick: null
        };
        viewers.push(entry);
        bindVisibility();

        controls.addEventListener('start', function () {
            entry.userMoved = true;
            entry.interacting = true;
        });
        controls.addEventListener('end', function () {
            entry.interacting = false;
        });
        entry.onPointer = function () {
            entry.interacting = true;
        };
        canvas.addEventListener('pointerdown', entry.onPointer);

        function currentFps() {
            if (profile.compact)
                return 22;
            if (preview)
                return 30;
            return entry.interacting ? 60 : 30;
        }

        function applySize() {
            var size = sizeOf(canvas);
            var dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
            renderer.setPixelRatio(dpr);
            renderer.setSize(size.cssWidth, size.cssHeight, false);
            camera.aspect = size.cssWidth / size.cssHeight;
            camera.updateProjectionMatrix();
            if (!entry.userMoved && size.cssWidth > 8 && size.cssHeight > 8)
                frame();
        }

        function frame() {
            var box = worldBox(root, THREE);
            var size = box.getSize(new THREE.Vector3());
            var center = box.getCenter(new THREE.Vector3());
            var fov = camera.fov * Math.PI / 180;
            var maxSize = Math.max(size.x, size.y, size.z, 0.001);
            var dist = (maxSize * 0.5) / Math.tan(fov * 0.5);
            var compact = profile.compact;
            var isCtrl = kind === 'controle' || /controller/i.test(String(modelUrl || ''));
            var zoom;
            if (isCtrl)
                zoom = preview ? 7.2 : (compact ? 15.5 : 8.54);
            else
                zoom = preview ? 1.28 : (compact ? 3.8 : 1.58);
            var camDist = Math.max(dist * zoom, 0.05);
            camera.position.set(
                center.x + dist * 0.2,
                center.y + (preview ? dist * 0.22 : dist * 0.04),
                center.z + camDist
            );
            camera.near = Math.max(dist / 200, 0.01);
            camera.far = Math.max(dist * 80, 20);
            camera.lookAt(center);
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.minDistance = dist * 0.4;
            controls.maxDistance = Math.max(camDist * 1.5, dist * 12);
            controls.update();
        }

        function tick(now) {
            if (!viewers.includes(entry) || entry.paused)
                return;
            entry.raf = requestAnimationFrame(tick);
            var interval = 1000 / currentFps();
            if (entry.lastDraw && now - entry.lastDraw < interval)
                return;
            entry.lastDraw = now;
            controls.update();
            renderer.render(scene, camera);
        }

        entry.tick = tick;
        entry.onResize = applySize;
        window.addEventListener('resize', entry.onResize);
        if (window.ResizeObserver) {
            entry.resizeObserver = new ResizeObserver(applySize);
            entry.resizeObserver.observe(canvas);
        }
        if (window.IntersectionObserver) {
            entry.intersectObserver = new IntersectionObserver(function (records) {
                var rec = records[records.length - 1];
                entry.visible = !!(rec && rec.isIntersecting);
                syncPause(entry);
            }, { threshold: 0.05 });
            entry.intersectObserver.observe(canvas);
        }
        applySize();
        syncPause(entry);
        if (!entry.paused)
            tick(performance.now());
    }

    return {
        mount: mount,
        dispose: dispose,
        preload: preload,
        preloadListing: preloadListing,
        isCompact: isCompact
    };
})();
