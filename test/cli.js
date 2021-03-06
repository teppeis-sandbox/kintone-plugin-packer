'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const denodeify = require('denodeify');
const rimraf = denodeify(require('rimraf'));
const sinon = require('sinon');
const glob = require('glob');

const cli = require('../src/cli');
const fixturesDir = path.join(__dirname, 'fixtures');
const sampleDir = path.join(fixturesDir, 'sample-plugin');
const ppkPath = path.join(fixturesDir, 'private.ppk');

const ID = 'aaa';
const PRIVATE_KEY = 'PRIVATE_KEY';
const PLUGIN_BUFFER = Buffer.from('foo');

describe('cli', () => {
  it('is a function', () => {
    assert(typeof cli === 'function');
  });

  describe('validation', () => {
    let packer;
    beforeEach(() => {
      packer = sinon.stub().returns({
        id: ID,
        privateKey: PRIVATE_KEY,
        plugin: PLUGIN_BUFFER,
      });
    });

    it('invalid `url`', () => {
      assert.throws(() => {
        cli(path.join(fixturesDir, 'plugin-invalid-url'), {packerMock_: packer});
      }, /Invalid manifest.json/);
    });

    it('invalid `https-url`', () => {
      assert.throws(() => {
        cli(path.join(fixturesDir, 'plugin-invalid-https-url'), {packerMock_: packer});
      }, /Invalid manifest.json/);
    });

    it('invalid `relative-path`', () => {
      assert.throws(() => {
        cli(path.join(fixturesDir, 'plugin-invalid-relative-path'), {packerMock_: packer});
      }, /Invalid manifest.json/);
    });

    it('invalid `maxFileSize`', () => {
      assert.throws(() => {
        cli(path.join(fixturesDir, 'plugin-invalid-maxFileSize'), {packerMock_: packer});
      }, /Invalid manifest.json/);
    });
  });

  context('without ppk', () => {
    const pluginDir = path.join(sampleDir, 'plugin-dir');
    let packer;
    let resultPluginPath;
    beforeEach(() => {
      packer = sinon.stub().returns({
        id: ID,
        privateKey: PRIVATE_KEY,
        plugin: PLUGIN_BUFFER,
      });

      return rimraf(`${sampleDir}/*.*(ppk|zip)`)
        .then(() => cli(pluginDir, {packerMock_: packer}))
        .then(filePath => {
          resultPluginPath = filePath;
        });
    });

    it('calles `packer` with contents.zip as the 1st argument', () => {
      assert(packer.calledOnce);
      assert(packer.args[0][0]);
      const zip = new AdmZip(packer.args[0][0]);
      const files = zip.getEntries().map(entry => entry.entryName).sort();
      assert.deepEqual(files, [
        'image/icon.png',
        'manifest.json',
      ].sort());
    });

    it('calles `packer` with privateKey as the 2nd argument', () => {
      assert(packer.calledOnce);
      assert(packer.args[0][1] === undefined);
    });

    it('generates a private key file', () => {
      const privateKey = fs.readFileSync(path.join(sampleDir, `${ID}.ppk`), 'utf8');
      assert(privateKey === PRIVATE_KEY);
    });

    it('generates a plugin file', () => {
      const pluginBuffer = fs.readFileSync(resultPluginPath);
      assert(PLUGIN_BUFFER.equals(pluginBuffer));
    });
  });

  context('with ppk', () => {
    const pluginDir = path.join(sampleDir, 'plugin-dir');
    let packer;
    beforeEach(() => {
      packer = sinon.stub().returns({
        id: ID,
        privateKey: PRIVATE_KEY,
        plugin: PLUGIN_BUFFER,
      });

      return rimraf(`${sampleDir}/*.*(ppk|zip)`)
        .then(() => cli(pluginDir, {ppk: ppkPath, packerMock_: packer}));
    });

    it('calles `packer` with privateKey as the 2nd argument', () => {
      assert(packer.calledOnce);
      const ppkFile = fs.readFileSync(ppkPath, 'utf8');
      assert(packer.args[0][1] === ppkFile);
    });

    it('does not generate a private key file', () => {
      const ppkFiles = glob.sync(`${sampleDir}/*.ppk`);
      assert.deepEqual(ppkFiles, []);
    });
  });

  it('includes files listed in manifest.json only', () => {
    const pluginDir = path.join(fixturesDir, 'plugin-full-manifest');
    let packer = sinon.stub().returns({
      id: ID,
      privateKey: PRIVATE_KEY,
      plugin: PLUGIN_BUFFER,
    });

    return rimraf(`${sampleDir}/*.*(ppk|zip)`)
      .then(() => cli(pluginDir, {packerMock_: packer}))
      .then(() => {
        const zip = new AdmZip(packer.args[0][0]);
        const files = zip.getEntries().map(entry => entry.entryName).sort();
        assert.deepEqual(files, [
          'css/config.css',
          'css/desktop.css',
          'html/config.html',
          'image/icon.png',
          'js/config.js',
          'js/desktop.js',
          'js/mobile.js',
          'manifest.json',
        ].sort());
      });
  });

  it('includes files listed in manifest.json only', () => {
    const pluginDir = path.join(sampleDir, 'plugin-dir');
    const outputDir = path.join('test', '.output');
    const outputPluginPath = path.join(outputDir, 'foo.zip');
    let packer = sinon.stub().returns({
      id: ID,
      privateKey: PRIVATE_KEY,
      plugin: PLUGIN_BUFFER,
    });

    return rimraf(outputDir)
      .then(() => cli(pluginDir, {packerMock_: packer, out: outputPluginPath}))
      .then(resultPluginPath => {
        assert.equal(resultPluginPath, outputPluginPath);
        const pluginBuffer = fs.readFileSync(outputPluginPath);
        assert(PLUGIN_BUFFER.equals(pluginBuffer));
        const ppk = fs.readFileSync(path.join(outputDir, `${ID}.ppk`));
        assert.equal(PRIVATE_KEY, ppk);
      });
  });
});
