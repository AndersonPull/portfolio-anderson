window.produtoModel = (function () {
    var state = null;

    function sizeOf(canvas) {
        var rect = canvas.getBoundingClientRect();
        return {
            cssWidth: Math.max(1, rect.width),
            cssHeight: Math.max(1, rect.height)
        };
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function dispose() {
        if (!state)
            return;

        cancelAnimationFrame(state.raf);
        state.resizeObserver && state.resizeObserver.disconnect();
        window.removeEventListener('resize', state.onResize);
        state.controls && state.controls.dispose();
        state.renderer && state.renderer.dispose();
        if (state.scene) {
            state.scene.traverse(function (obj) {
                if (obj.geometry)
                    obj.geometry.dispose();
                if (obj.material) {
                    var materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach(function (m) {
                        if (m.map)
                            m.map.dispose();
                        m.dispose && m.dispose();
                    });
                }
            });
        }
        state = null;
    }

    function prepareRoot(gltfScene, THREE) {
        var root = new THREE.Group();
        var model = gltfScene;
        model.traverse(function (obj) {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
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

    function standPhoneUpright(root, THREE) {
        var size = worldBox(root, THREE).getSize(new THREE.Vector3());
        if (size.z >= size.x && size.z >= size.y)
            root.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        else if (size.x >= size.y && size.x >= size.z)
            root.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        root.updateMatrixWorld(true);

        size = worldBox(root, THREE).getSize(new THREE.Vector3());
        if (size.x < size.z)
            root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        root.updateMatrixWorld(true);

        root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
        root.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI);
        root.updateMatrixWorld(true);
    }

    function boxSize(root, THREE) {
        return worldBox(root, THREE).getSize(new THREE.Vector3());
    }

    function minAxis(s, THREE) {
        if (s.x <= s.y && s.x <= s.z)
            return new THREE.Vector3(1, 0, 0);
        if (s.y <= s.x && s.y <= s.z)
            return new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3(0, 0, 1);
    }

    function maxAxis(s, THREE) {
        if (s.x >= s.y && s.x >= s.z)
            return new THREE.Vector3(1, 0, 0);
        if (s.y >= s.x && s.y >= s.z)
            return new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3(0, 0, 1);
    }

    function rotateAxisOnto(root, from, onto, THREE) {
        from = from.clone().normalize();
        onto = onto.clone().normalize();
        var dot = from.dot(onto);
        if (dot > 0.999)
            return;
        if (dot < -0.999) {
            var ortho = Math.abs(from.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
            root.rotateOnWorldAxis(new THREE.Vector3().crossVectors(from, ortho).normalize(), Math.PI);
            return;
        }
        root.rotateOnWorldAxis(
            new THREE.Vector3().crossVectors(from, onto).normalize(),
            Math.acos(Math.min(1, Math.max(-1, dot)))
        );
    }

    function standControllerFlat(root, THREE) {
        root.rotation.set(0, 0, 0);
        root.quaternion.identity();
        root.scale.set(1, 1, 1);
        root.position.set(0, 0, 0);
        root.updateMatrixWorld(true);

        rotateAxisOnto(root, minAxis(boxSize(root, THREE), THREE), new THREE.Vector3(0, 0, 1), THREE);
        root.updateMatrixWorld(true);
        rotateAxisOnto(root, maxAxis(boxSize(root, THREE), THREE), new THREE.Vector3(1, 0, 0), THREE);
        root.updateMatrixWorld(true);
    }

    async function mount(canvas, modelUrl) {
        dispose();
        if (!canvas)
            return;

        var THREE = await import('three');
        var addons = await import('three/addons/loaders/GLTFLoader.js');
        var controlsMod = await import('three/addons/controls/OrbitControls.js');
        var dracoMod = await import('three/addons/loaders/DRACOLoader.js');

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe2e2e2);

        var camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;

        var controls = new controlsMod.OrbitControls(camera, canvas);
        controls.enableDamping = false;
        controls.autoRotate = false;
        controls.enableRotate = false;
        controls.enableZoom = false;
        controls.enablePan = false;

        scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.1));
        var key = new THREE.DirectionalLight(0xffffff, 1.35);
        key.position.set(2, 4, 6);
        key.castShadow = true;
        scene.add(key);
        var fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-3, 1, 2);
        scene.add(fill);

        var loader = new addons.GLTFLoader();
        var draco = new dracoMod.DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
        loader.setDRACOLoader(draco);

        var cartGltf = await loader.loadAsync(modelUrl);
        var cartRoot = prepareRoot(cartGltf.scene, THREE);
        cartRoot.rotation.order = 'YXZ';
        cartRoot.rotation.set(-0.14, 0.38, 0.05);
        scene.add(cartRoot);

        var phoneRoot = null;
        var phoneStandQ = null;
        try {
            var phoneGltf = await loader.loadAsync('3dModels/SmartPhone.glb');
            phoneRoot = prepareRoot(phoneGltf.scene, THREE);
            standPhoneUpright(phoneRoot, THREE);
            phoneStandQ = phoneRoot.quaternion.clone();
            var cartBox0 = worldBox(cartRoot, THREE);
            var phoneBox0 = worldBox(phoneRoot, THREE);
            var cartSize = cartBox0.getSize(new THREE.Vector3());
            var phoneSize = phoneBox0.getSize(new THREE.Vector3());
            var cartW = Math.max(cartSize.x, 0.001);
            var phoneW = Math.max(phoneSize.x, 0.001);
            var scale = (cartW * 1.7) / phoneW;
            phoneRoot.scale.setScalar(scale);
            phoneRoot.updateMatrixWorld(true);
            scene.add(phoneRoot);
        } catch (e) {
            console.warn('smartphone model:', e);
        }

        var ctrlRoot = null;
        try {
            var ctrlGltf = await loader.loadAsync('3dModels/MobileController.glb');
            ctrlRoot = prepareRoot(ctrlGltf.scene, THREE);
            ctrlRoot.visible = false;
            scene.add(ctrlRoot);
        } catch (e) {
            console.warn('controller model:', e);
        }

        function parkPhoneOffscreen() {
            if (!phoneRoot)
                return;
            if (state && (state.docked || state.docking))
                return;

            var fov = camera.fov * Math.PI / 180;
            var look = controls.target;
            var dist = Math.max(Math.abs(camera.position.z - look.z), 0.01);
            var visH = 2 * Math.tan(fov * 0.5) * dist;
            var viewBottom = look.y - visH * 0.5;
            var box = worldBox(phoneRoot, THREE);
            phoneRoot.position.y += (viewBottom - visH * 0.2) - box.max.y;
        }

        function fitCamera(box, zoom) {
            var size = box.getSize(new THREE.Vector3());
            var center = box.getCenter(new THREE.Vector3());
            var fov = camera.fov * Math.PI / 180;
            var fitH = size.y;
            var fitW = size.x / camera.aspect;
            var dist = (Math.max(fitH, fitW, 0.001) * 0.5) / Math.tan(fov * 0.5);
            return {
                x: center.x,
                y: center.y,
                z: center.z + Math.max(dist * zoom, 0.01),
                tx: center.x,
                ty: center.y,
                tz: center.z,
                near: dist / 100,
                far: Math.max(dist * 50, 10)
            };
        }

        function applyCam(c) {
            camera.position.set(c.x, c.y, c.z);
            camera.near = c.near;
            camera.far = c.far;
            camera.lookAt(c.tx, c.ty, c.tz);
            camera.updateProjectionMatrix();
            controls.target.set(c.tx, c.ty, c.tz);
            controls.update();
        }

        function cartZoom() {
            return window.matchMedia('(max-width: 1024px)').matches ? 1.425 : 3.7;
        }

        function pairZoom() {
            return window.matchMedia('(max-width: 1024px)').matches ? 1.35 : 1.85;
        }

        function pairBox() {
            var box = new THREE.Box3();
            box.union(worldBox(cartRoot, THREE));
            box.union(worldBox(phoneRoot, THREE));
            return box;
        }

        function frameScene() {
            var s = sizeOf(canvas);
            renderer.setSize(s.cssWidth, s.cssHeight, false);
            camera.aspect = s.cssWidth / s.cssHeight;

            if (state && (state.docking || state.opening))
                return;

            if (state && state.attached && phoneRoot && ctrlRoot) {
                var rig = new THREE.Box3();
                rig.union(worldBox(phoneRoot, THREE));
                rig.union(worldBox(ctrlRoot, THREE));
                applyCam(fitCamera(rig, pairZoom()));
                return;
            }

            if (state && state.opened && phoneRoot) {
                applyCam(fitCamera(worldBox(phoneRoot, THREE), pairZoom()));
                return;
            }

            if (state && state.docked && phoneRoot) {
                applyCam(fitCamera(pairBox(), pairZoom()));
                return;
            }

            applyCam(fitCamera(worldBox(cartRoot, THREE), cartZoom()));
            parkPhoneOffscreen();
        }

        frameScene();

        function tick() {
            if (!state)
                return;
            renderer.render(scene, camera);
            state.raf = requestAnimationFrame(tick);
        }

        var onResize = function () { frameScene(); };
        var resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(canvas);
        window.addEventListener('resize', onResize);

        state = {
            THREE: THREE,
            scene: scene,
            camera: camera,
            renderer: renderer,
            controls: controls,
            cartRoot: cartRoot,
            phoneRoot: phoneRoot,
            phoneStandQ: phoneStandQ,
            ctrlRoot: ctrlRoot,
            canvas: canvas,
            docked: false,
            docking: false,
            opened: false,
            opening: false,
            attached: false,
            raf: 0,
            onResize: onResize,
            resizeObserver: resizeObserver,
            frameScene: frameScene
        };

        tick();
    }

    function lerp(a, b, k) {
        return a + (b - a) * k;
    }

    function midCam(t) {
        var a = 0.2;
        var b = 0.72;
        if (t <= a)
            return 0;
        if (t >= b)
            return 1;
        return easeInOutCubic((t - a) / (b - a));
    }

    function playDock() {
        return new Promise(function (resolve) {
            if (!state || !state.phoneRoot || state.docked || state.docking || state.opened || state.opening) {
                resolve();
                return;
            }

            state.docking = true;
            var THREE = state.THREE;
            var cart = state.cartRoot;
            var phone = state.phoneRoot;
            var cam = state.camera;
            var duration = 1700;
            var start = performance.now();

            var cartStartY = cart.position.y;
            var phoneStartY = phone.position.y;
            var phoneStartQ = phone.quaternion.clone();
            var cartStartEuler = new THREE.Euler().copy(cart.rotation);
            cartStartEuler.order = 'YXZ';
            var lookY = state.controls.target.y;
            var endEuler = new THREE.Euler(-0.18, 0.55, 0, 'YXZ');
            var extraQ = new THREE.Quaternion().setFromEuler(endEuler);
            var phoneEndQ = extraQ.clone().multiply(phoneStartQ);

            cart.rotation.copy(endEuler);
            phone.quaternion.copy(phoneEndQ);
            cart.updateMatrixWorld(true);
            phone.updateMatrixWorld(true);

            var cartH = worldBox(cart, THREE).getSize(new THREE.Vector3()).y;
            var phoneH = worldBox(phone, THREE).getSize(new THREE.Vector3()).y;
            var contactY = lookY + (phoneH - cartH) * 0.5;
            var cartEndY = contactY + cartH * 0.5;
            var phoneEndY = contactY - phoneH * 0.5;

            cart.position.y = cartEndY;
            phone.position.y = phoneEndY;
            var cartBoxSit = worldBox(cart, THREE);
            var phoneBoxSit = worldBox(phone, THREE);
            var gap = cartBoxSit.min.y - phoneBoxSit.max.y;
            cartEndY -= gap + cartH * 0.38;
            cart.position.y = cartEndY;

            var camStart = {
                x: cam.position.x,
                y: cam.position.y,
                z: cam.position.z,
                tx: state.controls.target.x,
                ty: state.controls.target.y,
                tz: state.controls.target.z,
                near: cam.near,
                far: cam.far
            };

            var endBox = new THREE.Box3();
            endBox.union(worldBox(cart, THREE));
            endBox.union(worldBox(phone, THREE));
            var s = sizeOf(state.canvas);
            state.renderer.setSize(s.cssWidth, s.cssHeight, false);
            cam.aspect = s.cssWidth / s.cssHeight;
            var fov = cam.fov * Math.PI / 180;
            var size = endBox.getSize(new THREE.Vector3());
            var center = endBox.getCenter(new THREE.Vector3());
            var fitH = size.y;
            var fitW = size.x / cam.aspect;
            var dist = (Math.max(fitH, fitW, 0.001) * 0.5) / Math.tan(fov * 0.5);
            var zoom = window.matchMedia('(max-width: 1024px)').matches ? 1.35 : 1.85;
            var camEnd = {
                x: center.x,
                y: center.y,
                z: center.z + Math.max(dist * zoom, 0.01),
                tx: center.x,
                ty: center.y,
                tz: center.z,
                near: dist / 100,
                far: Math.max(dist * 50, 10)
            };
            cart.position.y = cartStartY;
            phone.position.y = phoneStartY;
            cart.rotation.copy(cartStartEuler);
            phone.quaternion.copy(phoneStartQ);

            function applyCam(c) {
                cam.position.set(c.x, c.y, c.z);
                cam.near = c.near;
                cam.far = c.far;
                cam.lookAt(c.tx, c.ty, c.tz);
                cam.updateProjectionMatrix();
                state.controls.target.set(c.tx, c.ty, c.tz);
                state.controls.update();
            }

            function step(now) {
                if (!state) {
                    resolve();
                    return;
                }
                var t = Math.min(1, (now - start) / duration);
                var k = easeInOutCubic(t);
                var ck = midCam(t);
                cart.position.y = lerp(cartStartY, cartEndY, k);
                phone.position.y = lerp(phoneStartY, phoneEndY, k);
                cart.rotation.set(
                    lerp(cartStartEuler.x, endEuler.x, k),
                    lerp(cartStartEuler.y, endEuler.y, k),
                    lerp(cartStartEuler.z, endEuler.z, k),
                    'YXZ'
                );
                phone.quaternion.slerpQuaternions(phoneStartQ, phoneEndQ, k);
                applyCam({
                    x: lerp(camStart.x, camEnd.x, ck),
                    y: lerp(camStart.y, camEnd.y, ck),
                    z: lerp(camStart.z, camEnd.z, ck),
                    tx: lerp(camStart.tx, camEnd.tx, ck),
                    ty: lerp(camStart.ty, camEnd.ty, ck),
                    tz: lerp(camStart.tz, camEnd.tz, ck),
                    near: lerp(camStart.near, camEnd.near, ck),
                    far: lerp(camStart.far, camEnd.far, ck)
                });

                if (t < 1) {
                    requestAnimationFrame(step);
                    return;
                }

                cart.position.y = cartEndY;
                phone.position.y = phoneEndY;
                cart.rotation.copy(endEuler);
                phone.quaternion.copy(phoneEndQ);
                applyCam(camEnd);
                state.docked = true;
                state.docking = false;
                resolve();
            }

            requestAnimationFrame(step);
        });
    }

    function setMeshOpacity(root, value) {
        root.traverse(function (obj) {
            if (!obj.material)
                return;
            var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(function (m) {
                m.transparent = true;
                m.opacity = value;
                m.depthWrite = value > 0.92;
            });
        });
    }

    function snapshotObj(obj) {
        return {
            pos: obj.position.clone(),
            quat: obj.quaternion.clone(),
            scale: obj.scale.clone()
        };
    }

    function restoreObj(obj, snap) {
        obj.position.copy(snap.pos);
        obj.quaternion.copy(snap.quat);
        obj.scale.copy(snap.scale);
        obj.updateMatrixWorld(true);
    }

    function snapshotCam(cam) {
        return {
            x: cam.position.x,
            y: cam.position.y,
            z: cam.position.z,
            tx: state.controls.target.x,
            ty: state.controls.target.y,
            tz: state.controls.target.z,
            near: cam.near,
            far: cam.far
        };
    }

    function applyCamState(cam, c) {
        cam.position.set(c.x, c.y, c.z);
        cam.near = c.near;
        cam.far = c.far;
        cam.lookAt(c.tx, c.ty, c.tz);
        cam.updateProjectionMatrix();
        state.controls.target.set(c.tx, c.ty, c.tz);
        state.controls.update();
    }

    function spanEase(t, a, b) {
        if (t <= a)
            return 0;
        if (t >= b)
            return 1;
        return easeInOutCubic((t - a) / (b - a));
    }

    function mixObj(obj, from, to, k) {
        obj.position.lerpVectors(from.pos, to.pos, k);
        obj.quaternion.slerpQuaternions(from.quat, to.quat, k);
        obj.scale.set(
            lerp(from.scale.x, to.scale.x, k),
            lerp(from.scale.y, to.scale.y, k),
            lerp(from.scale.z, to.scale.z, k)
        );
        obj.updateMatrixWorld(true);
    }

    function mixCam(cam, from, to, k) {
        applyCamState(cam, {
            x: lerp(from.x, to.x, k),
            y: lerp(from.y, to.y, k),
            z: lerp(from.z, to.z, k),
            tx: lerp(from.tx, to.tx, k),
            ty: lerp(from.ty, to.ty, k),
            tz: lerp(from.tz, to.tz, k),
            near: lerp(from.near, to.near, k),
            far: lerp(from.far, to.far, k)
        });
    }

    function playOpen() {
        return new Promise(function (resolve) {
            if (!state || !state.phoneRoot || !state.docked || state.opened || state.opening || state.docking) {
                resolve();
                return;
            }

            state.opening = true;
            var THREE = state.THREE;
            var cart = state.cartRoot;
            var phone = state.phoneRoot;
            var ctrl = state.ctrlRoot;
            var cam = state.camera;
            var duration = 2400;
            var start = performance.now();

            var cartStartY = cart.position.y;
            var camStart = snapshotCam(cam);
            var phoneFrom = snapshotObj(phone);
            var fov = cam.fov * Math.PI / 180;
            var dist = Math.max(Math.abs(cam.position.z - camStart.tz), 0.01);
            var visH = 2 * Math.tan(fov * 0.5) * dist;
            var viewTop = camStart.ty + visH * 0.5;
            var cartEndY = cartStartY + (viewTop + visH * 0.45) - worldBox(cart, THREE).min.y;

            faceFront();
            var phoneTo = snapshotObj(phone);
            var ctrlTo = ctrl ? snapshotObj(ctrl) : null;
            var camEnd = snapshotCam(cam);

            restoreObj(phone, phoneFrom);
            if (ctrl && ctrlTo) {
                restoreObj(ctrl, ctrlTo);
                var ctrlFrom = snapshotObj(ctrl);
                ctrlFrom.pos = ctrlTo.pos.clone();
                ctrlFrom.pos.y -= 0.018;
                ctrlFrom.pos.z -= 0.06;
                ctrl.position.copy(ctrlFrom.pos);
                ctrl.quaternion.copy(ctrlTo.quat);
                ctrl.scale.copy(ctrlTo.scale);
                ctrl.visible = true;
                setMeshOpacity(ctrl, 0);
            }
            applyCamState(cam, camStart);

            function step(now) {
                if (!state) {
                    resolve();
                    return;
                }
                var t = Math.min(1, (now - start) / duration);
                var cartK = spanEase(t, 0, 0.5);
                var phoneK = spanEase(t, 0, 0.72);
                var camK = spanEase(t, 0.06, 0.8);
                var ctrlK = spanEase(t, 0.34, 1);
                var ctrlFade = spanEase(t, 0.32, 0.9);
                var fade = 1 - spanEase(t, 0.08, 0.48);

                cart.position.y = lerp(cartStartY, cartEndY, cartK);
                setMeshOpacity(cart, Math.max(0, fade));
                if (fade <= 0.001)
                    cart.visible = false;

                mixObj(phone, phoneFrom, phoneTo, phoneK);
                if (ctrl && ctrlTo) {
                    ctrl.visible = ctrlFade > 0.001;
                    setMeshOpacity(ctrl, ctrlFade);
                    var fromPos = ctrlTo.pos.clone();
                    fromPos.y -= 0.018;
                    fromPos.z -= 0.06;
                    ctrl.position.lerpVectors(fromPos, ctrlTo.pos, ctrlK);
                    ctrl.quaternion.copy(ctrlTo.quat);
                    ctrl.scale.copy(ctrlTo.scale);
                    ctrl.updateMatrixWorld(true);
                }
                mixCam(cam, camStart, camEnd, camK);

                if (t < 1) {
                    requestAnimationFrame(step);
                    return;
                }

                cart.visible = false;
                setMeshOpacity(cart, 0);
                restoreObj(phone, phoneTo);
                if (ctrl && ctrlTo) {
                    restoreObj(ctrl, ctrlTo);
                    setMeshOpacity(ctrl, 1);
                    ctrl.visible = true;
                }
                applyCamState(cam, camEnd);
                state.opened = true;
                state.attached = true;
                state.opening = false;
                resolve();
            }

            requestAnimationFrame(step);
        });
    }

    var PHONE_POSE = {
        quat: { x: -0.5, y: -0.5, z: -0.5, w: -0.5 },
        pos: { x: 0, y: 0.028, z: -0.003 },
        scale: 0.004
    };
    var CTRL_POSE = {
        quat: { x: 0, y: 0, z: 0, w: 1 },
        pos: { x: 0, y: -0.016, z: -0.011 },
        scale: 0.148
    };
    var CTRL_SIZE = { x: 0.9508, y: 0.3126, z: 0.0599 };

    function applyPose(obj, pose) {
        if (!obj || !pose)
            return;
        obj.quaternion.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
        obj.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
        obj.scale.setScalar(pose.scale);
        obj.updateMatrixWorld(true);
    }

    function applyCtrlPose(ctrl) {
        applyPose(ctrl, CTRL_POSE);
        if (!ctrl || !state)
            return;
        var THREE = state.THREE;
        var size = worldBox(ctrl, THREE).getSize(new THREE.Vector3());
        if (size.x > 0.00001)
            ctrl.scale.x *= CTRL_SIZE.x / size.x;
        ctrl.updateMatrixWorld(true);
        size = worldBox(ctrl, THREE).getSize(new THREE.Vector3());
        if (size.y > 0.00001)
            ctrl.scale.y *= CTRL_SIZE.y / size.y;
        ctrl.updateMatrixWorld(true);
        size = worldBox(ctrl, THREE).getSize(new THREE.Vector3());
        if (size.z > 0.00001)
            ctrl.scale.z *= CTRL_SIZE.z / size.z;
        ctrl.updateMatrixWorld(true);
    }

    function faceFront() {
        if (!state)
            return;
        var THREE = state.THREE;
        var phone = state.phoneRoot;
        var ctrl = state.ctrlRoot;

        applyPose(phone, PHONE_POSE);
        applyCtrlPose(ctrl);
        if (ctrl)
            ctrl.visible = true;

        var tiltQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, 0.55, 0, 'YXZ'));
        var pivotBox = new THREE.Box3();
        if (phone)
            pivotBox.union(worldBox(phone, THREE));
        if (ctrl)
            pivotBox.union(worldBox(ctrl, THREE));
        var pivot = pivotBox.getCenter(new THREE.Vector3());
        function tiltAround(obj) {
            if (!obj)
                return;
            obj.position.sub(pivot);
            obj.position.applyQuaternion(tiltQ);
            obj.position.add(pivot);
            obj.quaternion.premultiply(tiltQ);
            obj.updateMatrixWorld(true);
        }
        tiltAround(phone);
        tiltAround(ctrl);

        var box = new THREE.Box3();
        if (phone)
            box.union(worldBox(phone, THREE));
        if (ctrl)
            box.union(worldBox(ctrl, THREE));
        var s = sizeOf(state.canvas);
        state.renderer.setSize(s.cssWidth, s.cssHeight, false);
        state.camera.aspect = s.cssWidth / s.cssHeight;
        var size = box.getSize(new THREE.Vector3());
        var center = box.getCenter(new THREE.Vector3());
        var fov = state.camera.fov * Math.PI / 180;
        var dist = (Math.max(size.y, size.x / state.camera.aspect, 0.001) * 0.5) / Math.tan(fov * 0.5);
        var zoom = window.matchMedia('(max-width: 1024px)').matches ? 1.4 : 1.9;
        state.camera.position.set(center.x, center.y, center.z + Math.max(dist * zoom, 0.01));
        state.camera.near = dist / 100;
        state.camera.far = Math.max(dist * 50, 10);
        state.camera.lookAt(center);
        state.camera.updateProjectionMatrix();
        state.controls.target.copy(center);
        state.controls.update();
    }

    var loadSpinTimer = null;

    function startLoadSpin(el) {
        stopLoadSpin();
        if (!el)
            return;
        var frames = ['|', '/', '-', '\\'];
        var i = 0;
        el.textContent = frames[0];
        loadSpinTimer = setInterval(function () {
            if (!el.isConnected) {
                stopLoadSpin();
                return;
            }
            i = (i + 1) % frames.length;
            el.textContent = frames[i];
        }, 90);
    }

    function stopLoadSpin() {
        if (loadSpinTimer) {
            clearInterval(loadSpinTimer);
            loadSpinTimer = null;
        }
    }

    return {
        mount: mount,
        dispose: dispose,
        playDock: playDock,
        playOpen: playOpen,
        startLoadSpin: startLoadSpin,
        stopLoadSpin: stopLoadSpin
    };
})();
