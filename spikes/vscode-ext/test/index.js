const path = require('node:path');
const Mocha = require('mocha');

exports.run = () => {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120000 });
  mocha.addFile(path.join(__dirname, 'suite.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} tests failed`)) : resolve()));
  });
};
