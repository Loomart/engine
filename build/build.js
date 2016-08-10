/**
* build.js - compile playcanvas engine from source into single javascript library
* This uses the Closure Compiler which requires java to be installed
* Example usage:
*
* // regular release build
* node build.js -l 0 -o output/playcanvas-latest.js
* // production minified build
* node build.js -l 1 -o output/playcanvas-latest.min.js
* // include extra debug code
* node build.js -l 0 -d -o output/playcanvas-latest.dbg.js
*/

var fs = require("fs");
var util = require("util");
var path = require("path");
var cp = require("child_process");
var os = require("os");

try {
    var fse = require("fs-extra");
} catch (e) {
    console.error("Missing dependency: 'npm install fs-extra'");
    process.exit(1);
}
try {
    var ClosureCompiler = require("google-closure-compiler").compiler;
} catch (e) {
    console.error("Missing dependency: 'npm install google-closure-compiler'");
    process.exit(1);
}
try {
    var Preprocessor = require("preprocessor");
} catch (e) {
    console.error("Missing dependency: 'npm install preprocessor'");
    process.exit(1);
}

var DEFAULT_OUTPUT = "output/playcanvas-latest.js";
var DEFAULT_TEMP = "_tmp";
var SRC_DIR = "../";

var DEFAULT_PACKAGE = {
    "author": "PlayCanvas <support@playcanvas.com>",
    "description": "PlayCanvas WebGL Engine.",
    "engines": {
        "node": ">= 0.6.12"
    },
    "files": [
        "build/output/playcanvas-latest.js"
    ],
    "homepage": "https://playcanvas.com",
    "main": "build/output/playcanvas-latest.js",
    "name": "playcanvas",
    "repository": "https://github.com/playcanvas/engine",
    "version": ""
};

var COMPILER_LEVEL = [
    'WHITESPACE_ONLY',
    'SIMPLE',
    'ADVANCED'
];

var debug = false;
var profiler = false;
var outputPath = DEFAULT_OUTPUT;
var tempPath = DEFAULT_TEMP;
var compilerLevel = COMPILER_LEVEL[0];
var formattingLevel = undefined;

// LIB FUNCTIONS
if (!String.prototype.endsWith) {
  String.prototype.endsWith = function(searchString, position) {
      var subjectString = this.toString();
      if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
        position = subjectString.length;
      }
      position -= searchString.length;
      var lastIndex = subjectString.indexOf(searchString, position);
      return lastIndex !== -1 && lastIndex === position;
  };
}

function directoryExists(path) {
  try {
    return fs.statSync(path).isDirectory();
  }
  catch (err) {
    return false;
  }
}

var replaceAll = function(target, search, replacement) {
    return target.replace(new RegExp(search, 'g'), replacement);
};
// END LIB FUNCTIONS


// get git revision
var getRevision = function (callback) {
    var command = "git rev-parse --short HEAD";

    cp.exec(command, function (err, stdout, stderr) {
        if (err) {
            callback(err, '-');
            return;
        }
        callback(null, stdout.trim());
    });
};

// get version from VERSION file
var getVersion = function (callback) {
    fs.readFile('../VERSION', function (err, buffer) {
        if (err) {
            callback(err, "__CURRENT_SDK_VERSION__");
        }
        callback(null, buffer.toString().trim());
    });
};

// load dependencies.txt
var loadDependencies = function (fullpath, callback) {
    fs.readFile(fullpath, function (err, data) {
        if (err) callback(err);
        callback(data.toString().trim().split(new RegExp("[\\r\\n]+", 'g')));
    });
};

// load shader chunks and combine into single javascript file
var concatentateShaders = function (callback) {
    output = '../src/graphics/program-lib/chunks/generated-shader-chunks.js';
    dir = '../src/graphics/program-lib/chunks/';

    fd = fs.openSync(output, 'w');

    fs.writeSync(fd, "// autogenerated at: " + new Date() + "\n");
    fs.readdir(dir, function (err, files) {
        files.forEach(function (file) {
            var ext = null;
            ext = file.endsWith(".vert") ? "VS" : ext;
            ext = file.endsWith(".frag") ? "PS" : ext;
            if (ext) {
                var fullpath = dir + file;

                var content = replaceAll(fs.readFileSync(fullpath).toString(), "[\\r\\n]+", "\\n");
                var name = file.split(".")[0] + ext;
                var data = util.format('pc.shaderChunks.%s = "%s";\n', name, content);
                fs.writeSync(fd, data);
            }
        });

        callback();
    });
};


// run all dependencies through
// preprocesor (for #ifdef's etc)
// output to temp directory
// and return list of paths
var preprocess = function (dependencies) {
    // make temp dir and clear
    if (directoryExists(tempPath)) {
        fse.removeSync(tempPath);
    }

    var dependenciesOut = [];
    dependencies.forEach(function (filepath) {
        var relpath = path.relative(SRC_DIR, filepath);
        var _out = path.join(tempPath, relpath);

        var buffer = fs.readFileSync(filepath);

        var pp = new Preprocessor(buffer.toString());
        var src = pp.process({
            PROFILER: profiler,
            DEBUG: debug
        });

        var dir = path.dirname(_out);
        fse.ensureDirSync(dir);

        fs.writeFileSync(_out, src);

        dependenciesOut.push(_out);
    });

    return dependenciesOut;
};

// insert version and revision into output source file
var insertVersions = function (filepath, callback) {
    getRevision(function (err, rev) {
        getVersion(function (err, ver) {
            fs.readFile(filepath, function (err, buffer) {
                if (err) {
                    callback(err);
                }

                var content = buffer.toString();

                content = replaceAll(content, "__CURRENT_SDK_VERSION__", ver);
                content = replaceAll(content, "__REVISION__", rev);

                fs.writeFile(filepath, content, function (err) {
                    callback(err, ver);
                });
            });
        });
    });
};

// write package.json needed for a nodejs package
var packageJson = function (version) {
    var json = DEFAULT_PACKAGE;
    json.version = version;
    fs.writeFileSync("package.json", JSON.stringify(json, null, 4));
};

// remove temporary files
var cleanup = function () {
    if (directoryExists(tempPath)) {
        fse.removeSync(tempPath);
    }
};

var run = function () {
    var start = new Date().getTime();

    // build shader file
    concatentateShaders(function (err) {
        loadDependencies("./dependencies.txt", function (lines) {
            // preprocess and get new dependency list
            var files = preprocess(lines);

            // set compiler options
            var options = {
              js: files,
              compilation_level: compilerLevel,
              language_in: "ECMASCRIPT5",
              js_output_file: outputPath,
              manage_closure_dependencies: true,
              jscomp_off: [
                  "nonStandardJsDocs",  // docs warnings
                  "checkTypes", // array types and other missing types
                  "misplacedTypeAnnotation", // temp: hide docs using @type on defineProperty
                  "globalThis", // temp: remove this again
                  "suspiciousCode" // temp: remove this again
              ],
              externs: "externs.js",
              warning_level: "VERBOSE"
            };

            if (compilerLevel === "WHITESPACE_ONLY") {
                options.formatting = "pretty_print";
            }
            var closureCompiler = new ClosureCompiler(options);

            // compile
            var compilerProcess = closureCompiler.run(function(exitCode, stdOut, stdErr) {

                if (exitCode) {
                    console.error(stdErr);
                    process.exit(exitCode);
                } else {
                    if (stdErr) console.error(stdErr);
                    // print compiler output
                    if (stdOut) console.log(stdOut);

                    insertVersions(outputPath, function (err, version) {
                        if (err) {
                            console.error(err);
                            process.exit();
                        }

                        packageJson(version);
                        cleanup();

                        // done
                        var time = (new Date().getTime() - start) / 1000;
                        console.log("Build completed in " + time + " seconds!");
                        process.exit(0);

                    });
                }
            });

        });
    });
};

// parse arguments
var arguments = function () {
    var _last = null;
    var _arg = null;
    process.argv.forEach(function (arg) {
        if (arg === '-h') {
            console.log("Build Script for PlayCanvas Engine\n");
            console.log("Usage: node build.js -l [COMPILER_LEVEL] -o [OUTPUT_PATH]\n");
            console.log("Arguments:");
            console.log("-h: show this help");
            console.log("-l COMPILER_LEVEL: Set compiler level");
            console.log("\t0: WHITESPACE_ONLY [default]");
            console.log("\t1: SIMPLE");
            console.log("\t2: ADVANCED OPTIMIZATIONS");
            console.log("-o PATH: output file path [output/playcanvas-latest.js]");
            console.log("-d: build debug engine configuration");
            console.log("-p: build profiler engine configuration");
            process.exit();
        }

        if (arg === '-d') {
            debug = true;
        }

        if (arg === '-p') {
            profiler = true;
        }

        if (_last === '-l') {
            var level = parseInt(arg, 10);
            if (!(level >= 0 && level <= 2)) {
                console.error("Invalid compiler level (-l) should be: 0, 1 or 2.");
                process.exit(1);
            }
            compilerLevel = COMPILER_LEVEL[level];
        }

        if (_last === '-o') {
            outputPath = arg;
        }

        _last = arg;
    });
};

// only run from build directory
var cwd = process.cwd();
if (!fs.existsSync(cwd + '/build.js')) {
    console.error("run build script from build directory");
    process.exit(1);
}

arguments();
run();
