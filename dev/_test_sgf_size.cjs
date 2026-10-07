const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const start = source.indexOf('function parseSGF(text)');
const end = source.indexOf('function patchSGFComment(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
function parse(text) { context.text = text; return vm.runInContext('parseSGF(text)', context); }
for (const size of [9, 13, 19]) {
  test(`imports ${size}x${size} with its own board size`, () => {
    const rec = parse(`(;GM[1]FF[4]SZ[${size}]KM[7.5];B[aa];W[dd])`);
    assert.equal(rec.size, size);
    assert.equal(rec.moves.length, 2);
  });
}
test('13x13 uses its boundary when filtering moves and preserves comments and branches', () => {
  const rec = parse('(;FF[4]SZ[13]AB[aa]AW[bb]C[root SZ\\[19\\]];B[mm]C[edge](;W[nn]C[outside];W[cc]C[main])(;W[dd]C[variation]))');
  assert.equal(rec.size, 13);
  assert.equal(rec.moves.length, 2);
  assert.equal(rec.moves[0].x, 12);
  assert.equal(rec.moves[1].x, 2);
  assert.equal(rec.ab.length, 1);
  assert.equal(rec.aw.length, 1);
  assert.equal(rec.comments[2], 'main');
  assert.equal(rec.rootComment, 'root SZ[19]');
});
test('missing or invalid size keeps standard 19x19 fallback', () => {
  for (const size of ['', 'SZ[bad]', 'SZ[0]', 'SZ[53]']) {
    assert.equal(parse(`(;FF[4]${size};B[dd])`).size, 19);
  }
});
test('size is independent of current board and unrelated root properties', () => {
  context.N = 19;
  assert.equal(parse('(;C[comment with (parentheses)]\nPB[player]\nSZ [13];B[jd];W[jj])').size, 13);
  context.N = 9;
  assert.equal(parse('(;SZ[19];B[ss])').size, 19);
});
test('400 generated records retain main-line moves, metadata and comment positions', () => {
  for (let i = 0; i < 400; i++) {
    const size = [9, 13, 19][i % 3];
    const count = 1 + i % 30;
    const expected = Array.from({ length: count }, (_, j) => ({
      color: j % 2 ? 'w' : 'b', x: (j * 3) % size, y: (j * 7) % size,
    }));
    const line = expected.map((m, j) => {
      const coord = String.fromCharCode(97 + m.x, 97 + m.y);
      return `;${m.color.toUpperCase()}[${coord}]C[move ${j + 1}]`;
    });
    const root = `(;FF[4]SZ[${size}]PB[black]PW[white]AB[aa][bb]\r\nAW[cc]KM[6.5]C[root\\] text]`;
    const sgf = root + line[0] + (count > 1 ? '(' + line.slice(1).join('') + ')(;W[dd]C[variation])' : '') + ')';
    const rec = parse(sgf);
    assert.equal(rec.size, size);
    assert.equal(rec.moves.length, count);
    assert.equal(rec.ab.length, 2);
    assert.equal(rec.aw.length, 1);
    assert.equal(rec.komi, 6.5);
    assert.equal(rec.pb, 'black');
    assert.equal(rec.rootComment, 'root] text');
    expected.forEach((m, j) => {
      assert.equal(rec.moves[j].color, m.color);
      assert.equal(rec.moves[j].x, m.x);
      assert.equal(rec.moves[j].y, m.y);
      assert.equal(rec.comments[j + 1], `move ${j + 1}`);
    });
  }
});
