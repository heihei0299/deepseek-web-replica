// pow.js — 把官方 PoW worker 包成 Promise（worker + wasm 与站点同源副本）

let worker = null;
let chain = Promise.resolve();

function getWorker() {
  if (worker) return worker;
  worker = new Worker('/static/pow-worker.js');
  return worker;
}

export function solveChallenge(challenge, timeoutMs = 45000) {
  const run = () =>
    new Promise((resolve, reject) => {
      const w = getWorker();
      const onMessage = (e) => {
        const d = e.data || {};
        if (d.type === 'pow-answer') {
          cleanup();
          resolve(d.answer);
        } else if (d.type === 'pow-error') {
          cleanup();
          reject(new Error(String(d.error?.message || d.error || 'PoW 求解失败')));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('PoW 求解超时'));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        w.removeEventListener('message', onMessage);
      }
      w.addEventListener('message', onMessage);
      w.postMessage({
        type: 'pow-challenge',
        challenge: { ...challenge, expireAt: challenge.expire_at ?? challenge.expireAt },
      });
    });

  // 串行化：worker 一次只处理一个挑战
  const task = chain.then(run, run);
  chain = task.catch(() => {});
  return task;
}

export function powHeaderValue(answer, targetPath) {
  const payload = {
    algorithm: answer.algorithm,
    challenge: answer.challenge,
    salt: answer.salt,
    answer: answer.answer,
    signature: answer.signature,
    target_path: targetPath,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
