/**
 * Traditional Chinese, the source table: `en` follows its shape exactly. One file per area.
 */
import { common } from './common'
import { welcome } from './welcome'
import { settings } from './settings'
import { tree } from './tree'
import { http } from './http'
import { tls } from './tls'
import { tlsCheck } from './tls-main'
import { docs } from './docs'
import { ws } from './ws'
import { shortcuts } from './shortcuts'
import { transfer } from './transfer'
import { transferMain } from './transfer-main'
import { scriptMain } from './script-main'
import { httpMain } from './http-main'
import { git } from './git'
import { gitMain } from './git-main'
import { mock } from './mock'
import { runner } from './runner'
import { runnerMain } from './runner-main'
import { auth, scripts } from './scripts'
import { editor, env, history, tabs, vars, workspace } from './workspace'

export const zhTW = {
  common,
  welcome,
  settings,
  tree,
  workspace,
  env,
  history,
  tabs,
  vars,
  editor,
  http,
  auth,
  scripts,
  tls,
  docs,
  ws,
  shortcuts,
  transfer,
  git,
  mock,
  runner,
  tlsCheck,
  gitMain,
  runnerMain,
  transferMain,
  scriptMain,
  httpMain
}

export type Messages = typeof zhTW
