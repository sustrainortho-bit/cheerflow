// Firestoreセキュリティルールのテスト。`npm run test:rules` でエミュレーター上で実行する。
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cheerflow',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const OWNER = 'owner1', EDITOR = 'editor1', VIEWER = 'viewer1', STRANGER = 'stranger1';
const db = (uid, email) => uid
  ? env.authenticatedContext(uid, { email: email || (uid + '@example.com'), email_verified: true }).firestore()
  : env.unauthenticatedContext().firestore();

function owned(extra) {
  return Object.assign({
    state: { title: 't', scenes: [] }, title: 't',
    ownerUid: OWNER, ownerName: 'Owner', ownerEmail: 'owner1@example.com',
    editorUids: [EDITOR], viewerUids: [VIEWER], memberUids: [OWNER, EDITOR, VIEWER],
    memberInfo: { [OWNER]: { name: 'Owner' }, [EDITOR]: { name: 'Ed' }, [VIEWER]: { name: 'Vi' } },
    inviteEmails: [], inviteEditors: [], linkRole: 'none', rev: 0
  }, extra || {});
}
function freshOwned(uid) {
  return {
    state: { title: 'new' }, title: 'new', ownerUid: uid,
    editorUids: [], viewerUids: [], memberUids: [uid], memberInfo: { [uid]: { name: 'Me' } },
    inviteEmails: [], inviteEditors: [], linkRole: 'none', rev: 0
  };
}
async function seed(id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'projects', id), data); });
}

/* ---------- 旧方式（アカウント導入前）のリンク共有プロジェクト ---------- */
test('legacy: 未ログインでも読める・従来どおり編集できる', async () => {
  await seed('L1', { state: { a: 1 }, updatedAt: 1 });
  await assertSucceeds(getDoc(doc(db(), 'projects', 'L1')));
  await assertSucceeds(updateDoc(doc(db(), 'projects', 'L1'), { state: { a: 2 } }));
});
test('legacy: 未ログインで余計なフィールドは書けない', async () => {
  await seed('L1', { state: { a: 1 }, updatedAt: 1 });
  await assertFails(updateDoc(doc(db(), 'projects', 'L1'), { ownerUid: 'x' }));
});
test('legacy: ログインした人は自分のアカウントに取り込める', async () => {
  await seed('L1', { state: { a: 1 }, updatedAt: 1 });
  await assertSucceeds(setDoc(doc(db(STRANGER), 'projects', 'L1'), freshOwned(STRANGER)));
});
test('legacy: 取り込み時に他人を混ぜられない・未ログインでは取り込めない', async () => {
  await seed('L1', { state: { a: 1 }, updatedAt: 1 });
  await assertFails(setDoc(doc(db(STRANGER), 'projects', 'L1'), Object.assign(freshOwned(STRANGER), { editorUids: ['friend'] })));
  await assertFails(setDoc(doc(db(STRANGER), 'projects', 'L1'), freshOwned(OWNER)));
  await assertFails(setDoc(doc(db(), 'projects', 'L1'), freshOwned('anyone')));
});

/* ---------- 新規作成 ---------- */
test('create: ログインした本人がオーナーとして作成できる', async () => {
  await assertSucceeds(setDoc(doc(db(OWNER), 'projects', 'P1'), freshOwned(OWNER)));
});
test('create: 未ログイン・他人名義・旧方式の形では作成できない', async () => {
  await assertFails(setDoc(doc(db(), 'projects', 'P1'), freshOwned(OWNER)));
  await assertFails(setDoc(doc(db(STRANGER), 'projects', 'P1'), freshOwned(OWNER)));
  await assertFails(setDoc(doc(db(OWNER), 'projects', 'P1'), { state: {}, updatedAt: 1 }));
  await assertFails(setDoc(doc(db(OWNER), 'projects', 'P1'), Object.assign(freshOwned(OWNER), { editorUids: [EDITOR] })));
});

/* ---------- 閲覧権限 ---------- */
test('get: メンバーは読める・部外者と未ログインは読めない（招待のみの設定）', async () => {
  await seed('P1', owned());
  for (const u of [OWNER, EDITOR, VIEWER]) await assertSucceeds(getDoc(doc(db(u), 'projects', 'P1')));
  await assertFails(getDoc(doc(db(STRANGER), 'projects', 'P1')));
  await assertFails(getDoc(doc(db(), 'projects', 'P1')));
});
test('get: リンク共有なら部外者・未ログインでも読める', async () => {
  await seed('P1', owned({ linkRole: 'viewer' }));
  await assertSucceeds(getDoc(doc(db(STRANGER), 'projects', 'P1')));
  await assertSucceeds(getDoc(doc(db(), 'projects', 'P1')));
});
test('get: 招待されたメールアドレスの人は参加前でも読める', async () => {
  await seed('P1', owned({ inviteEmails: ['guest@example.com'] }));
  await assertSucceeds(getDoc(doc(db('guest', 'guest@example.com'), 'projects', 'P1')));
});

/* ---------- 内容の編集 ---------- */
test('edit: オーナーと編集者は内容を編集できる', async () => {
  await seed('P1', owned());
  await assertSucceeds(updateDoc(doc(db(OWNER), 'projects', 'P1'), { state: { v: 1 }, rev: 1 }));
  await assertSucceeds(updateDoc(doc(db(EDITOR), 'projects', 'P1'), { state: { v: 2 }, title: 'x', rev: 2 }));
});
test('edit: 閲覧者・部外者・未ログインは編集できない', async () => {
  await seed('P1', owned({ linkRole: 'editor' }));
  await assertFails(updateDoc(doc(db(VIEWER), 'projects', 'P1'), { state: { v: 1 } }));
  await assertFails(updateDoc(doc(db(STRANGER), 'projects', 'P1'), { state: { v: 1 } }));
  await assertFails(updateDoc(doc(db(), 'projects', 'P1'), { state: { v: 1 } }));
});
test('edit: 編集者は共有設定や所有者を変えられない', async () => {
  await seed('P1', owned());
  await assertFails(updateDoc(doc(db(EDITOR), 'projects', 'P1'), { linkRole: 'editor' }));
  await assertFails(updateDoc(doc(db(EDITOR), 'projects', 'P1'), { editorUids: [EDITOR, STRANGER] }));
  await assertFails(updateDoc(doc(db(EDITOR), 'projects', 'P1'), { ownerUid: EDITOR }));
});

/* ---------- オーナーによる共有管理 ---------- */
test('owner: 招待・権限変更・リンク設定ができる', async () => {
  await seed('P1', owned());
  await assertSucceeds(updateDoc(doc(db(OWNER), 'projects', 'P1'), {
    inviteEmails: ['a@example.com'], inviteEditors: ['a@example.com'], linkRole: 'viewer'
  }));
  await assertSucceeds(updateDoc(doc(db(OWNER), 'projects', 'P1'), { editorUids: [], viewerUids: [VIEWER, EDITOR] }));
});
test('owner: 所有者の移譲・自分の除外・自分を編集者扱いにはできない', async () => {
  await seed('P1', owned());
  await assertFails(updateDoc(doc(db(OWNER), 'projects', 'P1'), { ownerUid: EDITOR }));
  await assertFails(updateDoc(doc(db(OWNER), 'projects', 'P1'), { memberUids: [EDITOR, VIEWER] }));
  await assertFails(updateDoc(doc(db(OWNER), 'projects', 'P1'), { editorUids: [EDITOR, OWNER] }));
  await assertFails(updateDoc(doc(db(OWNER), 'projects', 'P1'), { linkRole: 'public' }));
});

/* ---------- 招待の受諾 ---------- */
function acceptAs(uid, base, role, email) {
  const m = base.memberUids.concat([uid]);
  const info = Object.assign({}, base.memberInfo, { [uid]: { name: 'G' } });
  const upd = {
    memberUids: m, memberInfo: info,
    inviteEmails: base.inviteEmails.filter((e) => e !== email),
    inviteEditors: base.inviteEditors.filter((e) => e !== email)
  };
  if (role === 'editor') upd.editorUids = base.editorUids.concat([uid]);
  else upd.viewerUids = base.viewerUids.concat([uid]);
  return upd;
}
test('invite: 招待された本人は招待された役割で参加できる', async () => {
  const base = owned({ inviteEmails: ['g@example.com'], inviteEditors: ['g@example.com'] });
  await seed('P1', base);
  await assertSucceeds(updateDoc(doc(db('guest', 'g@example.com'), 'projects', 'P1'), acceptAs('guest', base, 'editor', 'g@example.com')));
});
test('invite: 閲覧者として招待された人は編集者として参加できない', async () => {
  const base = owned({ inviteEmails: ['g@example.com'] });
  await seed('P1', base);
  await assertFails(updateDoc(doc(db('guest', 'g@example.com'), 'projects', 'P1'), acceptAs('guest', base, 'editor', 'g@example.com')));
  await assertSucceeds(updateDoc(doc(db('guest', 'g@example.com'), 'projects', 'P1'), acceptAs('guest', base, 'viewer', 'g@example.com')));
});
test('invite: 招待されていない人・他人を一緒に追加することはできない', async () => {
  const base = owned({ inviteEmails: ['g@example.com'], inviteEditors: ['g@example.com'] });
  await seed('P1', base);
  await assertFails(updateDoc(doc(db(STRANGER), 'projects', 'P1'), acceptAs(STRANGER, base, 'editor', 'stranger1@example.com')));
  const sneaky = acceptAs('guest', base, 'editor', 'g@example.com');
  sneaky.editorUids = sneaky.editorUids.concat(['friend']);
  sneaky.memberUids = sneaky.memberUids.concat(['friend']);
  await assertFails(updateDoc(doc(db('guest', 'g@example.com'), 'projects', 'P1'), sneaky));
});
test('invite: メールの大文字小文字は区別しない', async () => {
  const base = owned({ inviteEmails: ['g@example.com'] });
  await seed('P1', base);
  await assertSucceeds(getDoc(doc(db('guest', 'G@Example.com'), 'projects', 'P1')));
});

/* ---------- リンクからの参加 ---------- */
function joinAs(uid, base, role) {
  const upd = {
    memberUids: base.memberUids.concat([uid]),
    memberInfo: Object.assign({}, base.memberInfo, { [uid]: { name: 'J' } })
  };
  if (role === 'editor') upd.editorUids = base.editorUids.concat([uid]);
  else upd.viewerUids = base.viewerUids.concat([uid]);
  return upd;
}
test('link: 「リンクで編集可」ならログインした人は編集者として参加できる', async () => {
  const base = owned({ linkRole: 'editor' });
  await seed('P1', base);
  await assertSucceeds(updateDoc(doc(db(STRANGER), 'projects', 'P1'), joinAs(STRANGER, base, 'editor')));
});
test('link: 「リンクで閲覧可」では閲覧者としてのみ参加できる', async () => {
  const base = owned({ linkRole: 'viewer' });
  await seed('P1', base);
  await assertFails(updateDoc(doc(db(STRANGER), 'projects', 'P1'), joinAs(STRANGER, base, 'editor')));
  await assertSucceeds(updateDoc(doc(db(STRANGER), 'projects', 'P1'), joinAs(STRANGER, base, 'viewer')));
});
test('link: 「招待のみ」・未ログインでは参加できない', async () => {
  const base = owned();
  await seed('P1', base);
  await assertFails(updateDoc(doc(db(STRANGER), 'projects', 'P1'), joinAs(STRANGER, base, 'viewer')));
  await seed('P2', owned({ linkRole: 'editor' }));
  await assertFails(updateDoc(doc(db(), 'projects', 'P2'), joinAs('anon', owned(), 'editor')));
});

/* ---------- 退出・削除 ---------- */
test('leave: 編集者は自分で抜けられる・オーナーは抜けられない', async () => {
  const base = owned();
  await seed('P1', base);
  const info = Object.assign({}, base.memberInfo); delete info[EDITOR];
  await assertSucceeds(updateDoc(doc(db(EDITOR), 'projects', 'P1'), {
    editorUids: [], memberUids: [OWNER, VIEWER], memberInfo: info
  }));
  await assertFails(updateDoc(doc(db(OWNER), 'projects', 'P1'), { memberUids: [VIEWER] }));
});
test('leave: 退出のついでに他人を外すことはできない', async () => {
  const base = owned();
  await seed('P1', base);
  await assertFails(updateDoc(doc(db(EDITOR), 'projects', 'P1'), {
    editorUids: [], viewerUids: [], memberUids: [OWNER]
  }));
});
test('delete: オーナーだけが削除できる', async () => {
  await seed('P1', owned());
  await assertFails(deleteDoc(doc(db(EDITOR), 'projects', 'P1')));
  await assertSucceeds(deleteDoc(doc(db(OWNER), 'projects', 'P1')));
  await seed('L1', { state: {}, updatedAt: 1 });
  await assertFails(deleteDoc(doc(db(), 'projects', 'L1')));
});

/* ---------- 一覧取得 ---------- */
test('list: 自分がメンバー・招待されているプロジェクトだけを一覧できる', async () => {
  await seed('P1', owned({ inviteEmails: ['g@example.com'] }));
  await assertSucceeds(getDocs(query(collection(db(EDITOR), 'projects'), where('memberUids', 'array-contains', EDITOR))));
  await assertSucceeds(getDocs(query(collection(db('guest', 'g@example.com'), 'projects'), where('inviteEmails', 'array-contains', 'g@example.com'))));
});
test('list: 他人の一覧・条件なしの全件取得はできない', async () => {
  await seed('P1', owned({ linkRole: 'editor' }));
  await seed('L1', { state: {}, updatedAt: 1 });
  await assertFails(getDocs(query(collection(db(STRANGER), 'projects'), where('memberUids', 'array-contains', OWNER))));
  await assertFails(getDocs(collection(db(STRANGER), 'projects')));
  await assertFails(getDocs(collection(db(), 'projects')));
});

/* ---------- 在席情報 ---------- */
test('presence: メンバーは自分の在席情報だけ書ける・読める', async () => {
  await seed('P1', owned());
  await assertSucceeds(setDoc(doc(db(EDITOR), 'projects', 'P1', 'presence', EDITOR), { name: 'Ed', at: 1 }));
  await assertFails(setDoc(doc(db(EDITOR), 'projects', 'P1', 'presence', OWNER), { name: 'x', at: 1 }));
  await assertFails(setDoc(doc(db(STRANGER), 'projects', 'P1', 'presence', STRANGER), { name: 's', at: 1 }));
  await assertSucceeds(getDocs(collection(db(VIEWER), 'projects', 'P1', 'presence')));
  await assertFails(getDocs(collection(db(STRANGER), 'projects', 'P1', 'presence')));
});

/* ---------- 閲覧専用スナップショット ---------- */
test('viewSnapshots: 作成とID指定の閲覧はできるが、一覧・変更はできない', async () => {
  await assertSucceeds(setDoc(doc(db(), 'viewSnapshots', 'S1'), { state: {}, createdAt: 1 }));
  await assertSucceeds(getDoc(doc(db(), 'viewSnapshots', 'S1')));
  await assertFails(getDocs(collection(db(), 'viewSnapshots')));
  await assertFails(updateDoc(doc(db(), 'viewSnapshots', 'S1'), { state: { x: 1 } }));
});
