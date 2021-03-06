'use strict';

const path = require('path');
const fs = require('fs');
const ZipFile = require('yazl').ZipFile;
const denodeify = require('denodeify');
/** @type {function(string, any): !Promise<any>} */
const writeFile = denodeify(fs.writeFile);
const mkdirp = denodeify(require('mkdirp'));
const streamBuffers = require('stream-buffers');
const debug = require('debug')('cli');
const validate = require('@teppeis/kintone-plugin-manifest-validator');

const packer = require('./');
const generateErrorMessages = require('./gen-error-msg');
const sourceList = require('./sourcelist');

/**
 * @param {string} pluginDir path to plugin directory.
 * @param {Object=} options {ppk: string, out: string}.
 * @return {!Promise<string>} The resolved value is a path to the output plugin zip file.
 */
function cli(pluginDir, options) {
  options = options || {};
  const packerLocal = options.packerMock_ ? options.packerMock_ : packer;

  // 1. check if pluginDir is a directory
  if (!fs.statSync(pluginDir).isDirectory()) {
    throw new Error(`${pluginDir} should be a directory.`);
  }

  // 2. check pluginDir/manifest.json
  const manifestJsonPath = path.join(pluginDir, 'manifest.json');
  if (!fs.statSync(manifestJsonPath).isFile()) {
    throw new Error('Manifest file $PLUGIN_DIR/manifest.json not found.');
  }

  // 3. validate manifest.json
  const manifest = loadJson(manifestJsonPath);
  throwIfInvalidManifest(manifest, pluginDir);

  let outputDir = path.dirname(path.resolve(pluginDir));
  let outputFile = path.join(outputDir, 'plugin.zip');
  if (options.out) {
    outputFile = options.out;
    outputDir = path.dirname(path.resolve(outputFile));
  }
  debug(`outputDir : ${outputDir}`);
  debug(`outputFile : ${outputFile}`);

  // 4. generate new ppk if not specified
  const ppkFile = options.ppk;
  /** @type {string?} */
  let privateKey;
  if (ppkFile) {
    debug(`loading an existing key: ${ppkFile}`);
    privateKey = fs.readFileSync(ppkFile, 'utf8');
  }

  // 5. package plugin.zip
  return Promise.all([
    mkdirp(outputDir),
    createContentsZip(pluginDir, manifest)
      .then(contentsZip => packerLocal(contentsZip, privateKey)),
  ]).then(result => {
    const output = result[1];
    if (!ppkFile) {
      fs.writeFileSync(path.join(outputDir, `${output.id}.ppk`), output.privateKey, 'utf8');
    }
    return outputPlugin(outputFile, output.plugin);
  });
}

module.exports = cli;

/**
 * @param {!Object} manifest
 * @param {string} pluginDir
 */
function throwIfInvalidManifest(manifest, pluginDir) {
  const result = validate(manifest, {
    relativePath: validateRelativePath(pluginDir),
    maxFileSize: validateMaxFileSize(pluginDir),
  });
  debug(result);

  if (!result.valid) {
    const msgs = generateErrorMessages(result.errors);
    console.error('Invalid manifest.json:');
    msgs.forEach(msg => {
      console.error(`- ${msg}`);
    });
    throw new Error('Invalid manifest.json');
  }
}

/**
 * Create contents.zip
 *
 * @param {string} pluginDir
 * @param {!Object} manifest
 * @return {!Promise<!Buffer>}
 */
function createContentsZip(pluginDir, manifest) {
  return new Promise((res, rej) => {
    const output = new streamBuffers.WritableStreamBuffer();
    const zipFile = new ZipFile();
    /** @type {?number} */
    let size = null;
    output.on('finish', () => {
      debug(`plugin.zip: ${size} bytes`);
      res(output.getContents());
    });
    zipFile.outputStream.pipe(output);
    sourceList(manifest).forEach(src => {
      zipFile.addFile(path.join(pluginDir, src), src);
    });
    zipFile.end(finalSize => {
      size = finalSize;
    });
  });
}

/**
 * Create and save plugin.zip
 *
 * @param {string} outputPath
 * @param {!Buffer} plugin
 * @return {!Promise<string>} The value is output path of plugin.zip.
 */
function outputPlugin(outputPath, plugin) {
  return writeFile(outputPath, plugin)
    .then(arg => outputPath);
}

/**
 * Load JSON file without caching
 *
 * @param {string} jsonPath
 * @return {Object}
 */
function loadJson(jsonPath) {
  const content = fs.readFileSync(jsonPath, 'utf8');
  return JSON.parse(content);
}

/**
 * Return validator for `relative-path` format
 *
 * @param {string} pluginDir
 * @return {function(string): boolean}
 */
function validateRelativePath(pluginDir) {
  /**
   * @param {string} str
   * @return {boolean}
   */
  const foo = str => {
    try {
      const stat = fs.statSync(path.join(pluginDir, str));
      return stat.isFile();
    } catch (e) {
      return false;
    }
  };
  return foo;
}

/**
 * Return validator for `maxFileSize` keyword
 *
 * @param {string} pluginDir
 * @return {function(number, string): boolean}
 */
function validateMaxFileSize(pluginDir) {
  return (/** @type {number} */ maxBytes, /** @type {string} */ filePath) => {
    try {
      const stat = fs.statSync(path.join(pluginDir, filePath));
      return stat.size <= maxBytes;
    } catch (e) {
      return false;
    }
  };
}
