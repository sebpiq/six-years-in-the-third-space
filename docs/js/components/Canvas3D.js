;(function () {
    const HOVER_DETECT_DEBOUNCE = TSP.config.get(
        'satellites.hoverDetectDebounce'
    )
    const SATELLITE_ROTATION_RADIUS = TSP.config.get(
        'satellites.planetaryRotationRadius'
    )[0]
    const CONTRIBUTIONS = TSP.config.get('contributions')
    const SPEAKER = TSP.config.get('speaker')

    const sheet = jss.default
        .createStyleSheet({
            main: {
                position: 'absolute',
                left: '0',
                top: '0',
                display: 'block',
            },
        })
        .attach()

    class Canvas3D extends HTMLElement {
        constructor() {
            super()
            this.canvas = document.createElement('canvas', { class: sheet.classes.main })
            this.appendChild(this.canvas)
            this.frameCount = 0

            // ------------ Camera
            this.tspCamera = new TSP.components.Camera()

            // ------------ Scene
            this.scene = new THREE.Scene()
            this.scene.add(this.tspCamera.camera)

            // ------------ Renderer
            this.renderer = new THREE.WebGLRenderer({
                alpha: true,
                antialias: true,
                canvas: this.canvas,
            })
            this.renderer.physicallyCorrectLights = true

            // ------------ state change handlers
            TSP.state.listen('window.dimensions', this.updateSize.bind(this))

            // ------------
            TSP.state.set('Canvas3D.gltfLoader', new THREE.GLTFLoader())
            this.lights = new TSP.components.Lights(
                this.getCamera(),
                this.getScene()
            )
            this.pointerEventsManager = new Canvas3DPointerEventsManager(this.getCamera())
            this.createObjects()
        }

        connectedCallback() {
            this.updateSize()
        }

        updateSize() {
            const windowDimensions = TSP.state.get('window.dimensions')
            this.canvas.width = windowDimensions.x * this.canvas.pixelRatio
            this.canvas.height = windowDimensions.y * this.canvas.pixelRatio
            this.renderer.setPixelRatio(window.devicePixelRatio)
            this.renderer.setSize(windowDimensions.x, windowDimensions.y)
        }

        createObjects() {
            // this.planet = new TSP.components.Planet()
            this.universe = new TSP.components.Universe()
            this.orbitControls = new Canvas3DOrbitControls(
                this.getCamera(),
                this.getCanvas()
            )

            const planetaryRotationAxes = TSP.utils
                .sphericalSpacedOnSphere(CONTRIBUTIONS.length + 1) // + 1 for speaker
                .map((spherical) => new TSP.components.RotationAxis(spherical))

            const satellitesState = {}
            this.speaker = new TSP.components.Satellite(null, SPEAKER.modelUrl, planetaryRotationAxes.pop(), 'soundControls')
            this.satellites = CONTRIBUTIONS.map((contribution, i) => {
                const satellite = new TSP.components.Satellite(
                    contribution.url,
                    contribution.satelliteModelUrl,
                    planetaryRotationAxes[i],
                    'arrow'
                )
                satellitesState[contribution.url] = satellite
                return satellite
            })
            TSP.state.set('Canvas3D.satellites', satellitesState)
            // TSP.state.set('Canvas3D.planet', this.planet)
        }

        getCamera() {
            return this.tspCamera.camera
        }

        getScene() {
            return this.scene
        }

        getRenderer() {
            return this.renderer
        }

        getCanvas() {
            return this.canvas
        }

        load() {
            const promises = Object.values(this.satellites).map((satellite) => {
                return satellite.load()
            })
            promises.push(this.universe.load())
            promises.push(this.speaker.load())
            // promises.push(this.planet.load())
            Promise.all(promises).then(() => {
                TSP.state.set('Canvas3D.loaded', true)
            })
        }

        start() {
            // this.planet.show(this.scene)
            this.universe.show(this.scene)
            this.tspCamera.show(this.scene)

            // this.pointerEventsManager.hoverableObjectsManager.addHoverable(
            //     this.planet.getHoverableObject3D(),
            //     this.planet
            // )
            
            this.speaker.show(this.scene)
            this.pointerEventsManager.hoverableObjectsManager.addHoverable(
                this.speaker.getHoverableObject3D(),
                this.speaker
            )

            Object.values(this.satellites).forEach((satellite) => {
                satellite.show(this.scene)
                this.pointerEventsManager.hoverableObjectsManager.addHoverable(
                    satellite.getHoverableObject3D(),
                    satellite
                )
                if (TSP.config.get('debug.satellites') === true) {
                    satellite.planetaryRotationAxis.show(this.scene)
                }
            })

            if (TSP.config.get('debug.satellites') === true) {
                this.axesHelper = new THREE.AxesHelper(
                    TSP.config.get('planet.radius') + 5
                )
                this.scene.add(this.axesHelper)
            }
            this.animate()
        }

        animate() {
            this.frameCount++
            requestAnimationFrame(this.animate.bind(this))
            Object.values(this.satellites).forEach((satellite) =>
                satellite.animate()
            )
            this.renderer.render(this.scene, this.tspCamera.camera)
            this.tspCamera.animate()
            this.universe.animate()
            this.speaker.animate()
            // this.planet.animate()
            this.pointerEventsManager.animate()
        }

        _animateNoop() {}
    }

    customElements.define('tsp-canvas-3d', Canvas3D)

    class Canvas3DHoverableObjectsManager {
        constructor() {
            this.raycaster = new THREE.Raycaster()
            this.hoveredObject = null
            this.hoverableObjects3D = []
            this.hoverableObjectsUuid = {}
        }

        addHoverable(object3D, datum) {
            this.hoverableObjects3D.push(object3D)
            this.hoverableObjectsUuid[object3D.uuid] = datum
        }

        getHoveredDatum() {
            return this.hoveredObject ? this.getDatum(this.hoveredObject) : null
        }

        // Detects if a new object is hovered and set it to `this.hoveredObject`.
        // Returns `true` if the `Canvas3DHoverableObjectsManager` state changed, `false` otherwise.
        setNewPosition(mouse, camera) {
            const newHoveredObject = this.detectHoveredObject(mouse, camera)
            if (newHoveredObject !== this.hoveredObject) {
                this.hoveredObject = newHoveredObject
                return true
            }
            return false
        }

        detectHoveredObject(mouse, camera) {
            const hoveredObjects = this.detectHoveredObjects(mouse, camera)
            if (hoveredObjects.length) {
                // If the currently hovered object is still intersected, we return that one
                if (hoveredObjects.indexOf(this.hoveredObject) !== -1) {
                    return this.hoveredObject
                }
                return hoveredObjects[0]
            }
            return null
        }

        detectHoveredObjects(mouse, camera) {
            this.raycaster.setFromCamera(mouse, camera)
            const intersects = this.raycaster.intersectObjects(
                this.hoverableObjects3D,
                true
            )
            return intersects.map((intersected) =>
                this._findHoverableObject(intersected.object)
            )
        }

        clearState() {
            this.hoveredObject = null
        }

        _findHoverableObject(object3D) {
            while (
                !(object3D.uuid in this.hoverableObjectsUuid) &&
                object3D.parent
            ) {
                object3D = object3D.parent
            }
            if (!this.hoverableObjectsUuid[object3D.uuid]) {
                console.error(`object cannot be found`)
            }
            return object3D
        }

        getDatum(object3D) {
            return object3D ? this.hoverableObjectsUuid[object3D.uuid] : null
        }
    }

    class Canvas3DPointerEventsManager {

        constructor(camera) {
            this.camera = camera
            this.hoverDetectionActive = false
            this.hoverableObjectsManager = new Canvas3DHoverableObjectsManager()
            this.mousePosition_Screen = new THREE.Vector2()
            this.canvasDimensions_Screen = null
            this.windowDimensionsChanged()

            // ------------ state change and event handlers
            TSP.state.listen(
                'App.currentUrl',
                this.currentUrlChanged.bind(this)
            )
            TSP.state.listen('window.dimensions', this.windowDimensionsChanged.bind(this))
            this.frameCount = 0

            window.addEventListener(
                'mousemove',
                this.onMouseMove.bind(this),
                false
            )

            window.addEventListener('click', this.onClick.bind(this), false)

            window.addEventListener(
                'touchstart',
                this.onTouchStart.bind(this),
                false
            )

            window.addEventListener(
                'touchmove',
                this.onTouchMove.bind(this),
                // With OrbitControls, we need `useCapture`
                // REF : https://github.com/mrdoob/three.js/issues/16254
                true
            )

            window.addEventListener(
                'touchend',
                this.onTouchEnd.bind(this),
                false
            )
        }

        currentUrlChanged(url) {
            if (url === '') {
                this.hoverDetectionActive = true
            } else {
                this.hoverDetectionActive = false
            }
        }

        windowDimensionsChanged() {
            const windowDimensions = TSP.state.get('window.dimensions')
            this.canvasDimensions_Screen = windowDimensions.clone()
        }

        onMouseMove(event) {
            if (
                TSP.state.get('App.isTouch') ||
                this.frameCount % HOVER_DETECT_DEBOUNCE !== 0 ||
                !this.hoverDetectionActive
            ) {
                return
            }
            this.mousePosition_Screen.set(event.clientX, event.clientY)
            this.refreshHoveredObjectState()
        }

        onClick() {
            if (TSP.state.get('App.isTouch') || !this.hoverDetectionActive) {
                return
            }
            if (TSP.state.get('Canvas3D.hoveredObject') !== null) {
                this.navigateToHoveredObject()
            }
        }

        onTouchStart(event) {
            if (!this.hoverDetectionActive) {
                return
            }
            this.hadTouchMove = false
            this.mousePosition_Screen.set(
                event.touches[0].clientX,
                event.touches[0].clientY
            )
        }

        onTouchMove(event) {
            if (!this.hoverDetectionActive) {
                return
            }
            const newMousePosition_Screen = new THREE.Vector2(
                event.touches[0].clientX,
                event.touches[0].clientY,
            )
            // Some devices trigger touch move immediatelly after touch start with same position.
            if (!newMousePosition_Screen.equals(this.mousePosition_Screen)) {
                this.hadTouchMove = true
            }
        }

        onTouchEnd() {
            if (this.hadTouchMove || !this.hoverDetectionActive) {
                return
            }
            const hoveredDatum = TSP.state.get('Canvas3D.hoveredObject')
            if (hoveredDatum === null) {
                this.refreshHoveredObjectState()
            } else {
                const actualHoveredObject = this.hoverableObjectsManager.detectHoveredObject(
                    this.getMousePositionNDC(this.mousePosition_Screen),
                    this.camera
                )
                if (
                    hoveredDatum ===
                    this.hoverableObjectsManager.getDatum(actualHoveredObject)
                ) {
                    this.navigateToHoveredObject()
                } else {
                    this.refreshHoveredObjectState()
                }
            }
        }

        refreshHoveredObjectState() {
            const hasChanged = this.hoverableObjectsManager.setNewPosition(
                this.getMousePositionNDC(this.mousePosition_Screen),
                this.camera
            )
            if (hasChanged) {
                TSP.state.set(
                    'Canvas3D.hoveredObject',
                    this.hoverableObjectsManager.getHoveredDatum()
                )
            }
        }

        navigateToHoveredObject() {
            const hoveredDatum = this.hoverableObjectsManager.getHoveredDatum()
            const url = hoveredDatum.getUrl()
            if (url === null) {
                return
            }
            this.hoverableObjectsManager.clearState()
            TSP.state.set('Canvas3D.hoveredObject', null)
            TSP.utils.navigateTo(hoveredDatum.getUrl())
        }

        getMousePositionNDC(mousePosition_Screen) {
            // calculate mouse position in normalized device coordinates
            // Ref : https://threejs.org/docs/#api/en/core/Raycaster
            return TSP.utils.toNDCPosition(
                mousePosition_Screen,
                this.canvasDimensions_Screen,
                new THREE.Vector2()
            )
        }

        animate() {
            this.frameCount++
            if (
                !TSP.state.get('App.isTouch') &&
                this.frameCount % HOVER_DETECT_DEBOUNCE === 0 &&
                this.hoverDetectionActive
            ) {
                this.refreshHoveredObjectState()
            }
        }

    }

    class Canvas3DOrbitControls {
        constructor(camera, canvas) {
            this.orbitControls = new THREE.OrbitControls(camera, canvas)
            this.orbitControls.enableKeys = false
            this.orbitControls.enablePan = false
            this.orbitControls.minDistance = SATELLITE_ROTATION_RADIUS / 2
            this.orbitControls.maxDistance = SATELLITE_ROTATION_RADIUS * 5
            this.orbitControls.addEventListener('end', this.onOrbitInteractionEnd.bind(this))
        }

        onOrbitInteractionEnd() {
            TSP.state.set('Canvas3D.orbitControls', null)            
        }
    }

    TSP.components.Canvas3D = Canvas3D
})()
