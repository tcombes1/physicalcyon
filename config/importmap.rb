# Pin npm packages by running ./bin/importmap

pin "application"
pin "@hotwired/turbo-rails", to: "turbo.min.js"
pin "@hotwired/stimulus", to: "stimulus.min.js"
pin "@hotwired/stimulus-loading", to: "stimulus-loading.js"
pin_all_from "app/javascript/controllers", under: "controllers"

pin "three",                                  to: "https://ga.jspm.io/npm:three@0.169.0/build/three.module.js"
pin "three/addons/loaders/GLTFLoader.js",     to: "https://ga.jspm.io/npm:three@0.169.0/examples/jsm/loaders/GLTFLoader.js"
pin "three/addons/controls/OrbitControls.js",       to: "https://ga.jspm.io/npm:three@0.169.0/examples/jsm/controls/OrbitControls.js"
pin "three/addons/lines/LineSegments2.js",          to: "https://ga.jspm.io/npm:three@0.169.0/examples/jsm/lines/LineSegments2.js"
pin "three/addons/lines/LineSegmentsGeometry.js",   to: "https://ga.jspm.io/npm:three@0.169.0/examples/jsm/lines/LineSegmentsGeometry.js"
pin "three/addons/lines/LineMaterial.js",           to: "https://ga.jspm.io/npm:three@0.169.0/examples/jsm/lines/LineMaterial.js"
