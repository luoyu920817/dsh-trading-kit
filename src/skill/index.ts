/**
 * 装配实现（change 3 tq-skill-installer tasks 4.2/4.3）：tq_skill_manage 工具 +
 * `traderKit.skill.{status,deployLocalDir}` 出口 + autocheck 接线。
 *
 * 装配纪律（`contracts §11`）：本文件只对既有 `traderKit` 服务追加 `skill` 面
 * （MUST NOT 重建 provide、MUST NOT 产出宿主两段视图出口——那是 change 2 的）；
 * 工具与 service 同一实现（facade 注入同一组函数，沿 review-daily 先例）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '../context-types.ts'
import type { ResolvedTraderKitConfig } from '../config.ts'
import { installSkill } from './installer.ts'
import { downloadToFile } from './download.ts'
import { buildSkillStatus } from './status.ts'
import { runUpdate } from './update.ts'
import { syncLocalDir } from './local-source.ts'
import { runAutoCheck } from './autocheck.ts'
import { resolveTargetRoot } from './root.ts'
import { join } from 'node:path'

/** 服务面形状（`traderKit.skill.*`；字段与 buildSkillStatus 的 SkillStatus 一致）。 */
export interface SkillServiceApi {
  status(input?: { cwd?: string }): Promise<Awaited<ReturnType<typeof buildSkillStatus>>>
  deployLocalDir(input: { sourcePath: string; targetRoot: string; name: string }): Promise<Awaited<ReturnType<typeof syncLocalDir>>>
}

/** 工具/服务共享的 facade（测试可注入替身；生产 = 本模块直连实现）。 */
export interface TqSkillFacades {
  installSkill: typeof installSkill
  runUpdate: typeof runUpdate
  buildSkillStatus: typeof buildSkillStatus
  syncLocalDir: typeof syncLocalDir
  resolveTargetRoot: typeof resolveTargetRoot
  /** https 源安装的下载 provider（生产 = downloadToFile 落临时区）。 */
  download: typeof downloadToFile
}

export function defaultTqSkillFacades(): TqSkillFacades {
  return { installSkill, runUpdate, buildSkillStatus, syncLocalDir, resolveTargetRoot, download: downloadToFile }
}

/** 工具输出（各 action 的公共形状；outcome/version/path/warnings 必在）。 */
interface ManageView {
  action: string
  outcome: string
  version: string | null
  path: string | null
  warnings: string[]
  residue: string[]
  [key: string]: unknown
}

function paramError(message: string): never {
  throw new Error(`参数错误：${message}`)
}

/**
 * status 的降级面：根解析失败（无 cwd 无 installDir——design D-1「拒绝猜测」）时
 * 返回全键占位结论而非抛出，供组合读取（change 2 侧）与工具调用方共同消费。
 */
function degradedStatus(config: ResolvedTraderKitConfig, cause: unknown): Awaited<ReturnType<typeof buildSkillStatus>> {
  return {
    state: 'missing',
    installed: false,
    version: null,
    previousVersion: null,
    availableVersion: null,
    baseline: null,
    targetRoot: '',
    name: 'tdx-tq-local',
    targetPath: '',
    skillPath: '',
    installDir: config.skill.installDir,
    source: { kind: 'https-zip', url: config.skill.sourceUrl, path: null, id: null, firstFetchedAt: null },
    sourceReachable: { state: 'unknown', checkedAt: null, reason: 'not probed' },
    contentHash: null,
    expectedHash: null,
    drift: 'unknown',
    discovery: { checked: false, mode: 'filesystem-only', cwdUsed: null, cwdSource: null, found: false, winner: null },
    shadowed: [],
    residue: [],
    resolvedCwd: null,
    projectRoot: null,
    cwdSource: null,
    lastCheckedAt: null,
    installedAt: null,
    installDirIgnored: false,
    warnings: [
      '状态未配置（state=missing）：' + (cause instanceof Error ? cause.message : String(cause))
      + '——配置 skill.installDir 或调用时传 cwd 后恢复完整状态视图。',
    ],
  } as Awaited<ReturnType<typeof buildSkillStatus>>
}

/** 分派各 action（runTqSkillManage = 工具与未来直接调用共用的单点实现）。 */
export async function runTqSkillManage(
  facades: TqSkillFacades,
  config: ResolvedTraderKitConfig,
  input: {
    action: 'install' | 'update' | 'status' | 'deploy' | 'uninstall'
    force?: boolean
    cwd?: string
    purge?: boolean
    sourcePath?: string
    targetRoot?: string
    name?: string
  },
): Promise<ManageView> {
  const skill = config.skill
  const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : undefined
  const name = input.name ?? 'tdx-tq-local'

  switch (input.action) {
    case 'status': {
      let status: Awaited<ReturnType<typeof buildSkillStatus>>
      try {
        status = await facades.buildSkillStatus({
          cwd,
          name,
          installDir: skill.installDir,
          minVersion: skill.minVersion,
          extraSkillRoots: skill.extraSkillRoots,
        })
      } catch (cause) {
        status = degradedStatus(config, cause)
      }
      return {
        action: 'status',
        outcome: status.state,
        version: status.version,
        path: status.targetPath,
        warnings: status.warnings,
        residue: [],
        detail: status,
      }
    }
    case 'install': {
      const resolved = facades.resolveTargetRoot({ installDir: skill.installDir, projectRoot: cwd ?? null, kind: 'https-zip' })
      // 生产下载 provider：延迟到安装器断言全部通过后才出站（零断言失败出站纪律）。
      const result = await facades.installSkill({
        targetRoot: resolved.targetRoot,
        name,
        kind: 'https-zip',
        sourceUrl: skill.sourceUrl,
        limits: skill.limits,
        archiveProvider: async (ctx) => {
          // 安装器已给出 runDir 内的落盘路径（ctx.archivePath）；条件请求头由
          // meta（readMeta 侧）传递，本 provider 只负责「这次出站拿回字节」。
          const dl = await facades.download({
            url: skill.sourceUrl,
            destinationPath: ctx.archivePath,
          })
          if (dl.status !== 200 || dl.archivePath === undefined) {
            throw new Error(`源未返回新内容（status=${dl.status}）——如需覆盖安装请先 uninstall 或等待版本变更`)
          }
          const { readFile } = await import('node:fs/promises')
          const bytes = await readFile(dl.archivePath)
          const { createHash } = await import('node:crypto')
          return { archiveBytes: new Uint8Array(bytes), archiveHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
        },
      })
      return {
        action: 'install',
        outcome: result.outcome,
        version: result.version,
        path: result.path,
        warnings: result.warnings,
        residue: result.residue,
        contentHash: result.contentHash,
      }
    }
    case 'update': {
      const resolved = facades.resolveTargetRoot({ installDir: skill.installDir, projectRoot: cwd ?? null, kind: 'https-zip' })
      const result = await facades.runUpdate({
        sourceUrl: skill.sourceUrl,
        targetRoot: resolved.targetRoot,
        name,
        minVersion: skill.minVersion,
        force: input.force === true,
        limits: skill.limits,
      })
      return {
        action: 'update',
        outcome: result.outcome,
        version: result.version ?? null,
        path: result.path ?? null,
        warnings: result.warnings,
        residue: result.residue ?? [],
      }
    }
    case 'deploy': {
      if (input.sourcePath === undefined || input.targetRoot === undefined || input.name === undefined) {
        paramError('deploy 需要显式 sourcePath + targetRoot + name（本地目录源三参；无默认实例）')
      }
      const result = await facades.syncLocalDir({
        sourcePath: input.sourcePath,
        targetRoot: input.targetRoot,
        name: input.name,
      })
      return {
        action: 'deploy',
        outcome: result.outcome,
        version: result.version ?? null,
        path: result.skillPath ?? null,
        warnings: result.warnings ?? [],
        residue: [],
        diff: result.diff ?? null,
      }
    }
    case 'uninstall': {
      // 幂等卸载：删落点 + 残留清理；purge 控制 meta.json（4.5）。
      const resolved = facades.resolveTargetRoot({ installDir: skill.installDir, projectRoot: cwd ?? null, kind: 'https-zip' })
      const { uninstallSkill } = await import('./uninstall.ts')
      const result = await uninstallSkill({ cwd, targetRoot: resolved.targetRoot, name, purge: input.purge === true })
      return {
        action: 'uninstall',
        outcome: result.outcome,
        version: null,
        path: join(resolved.targetRoot, name),
        warnings: result.warnings ?? [],
        residue: result.residue ?? [],
      }
    }
    default:
      paramError(`未知 action '${String(input.action)}'——允许 install|update|status|deploy|uninstall`)
  }
}

/** 工具定义（4.2；facade 注入可测）。 */
export function createTqSkillManageTool(facades: TqSkillFacades, config: ResolvedTraderKitConfig) {
  return defineTool({
    name: 'tq_skill_manage',
    description:
      '管理 TQ 行情技能包（tdx-tq-local）的安装与状态。action=install 从官方 zip 安装（源不可达时保留现版）；'
      + 'action=update 检查并应用更新（304 = 已是最新；降级需 force=true）；action=status 查看安装状态与版本；'
      + 'action=deploy 从本地目录部署自产 skill（需显式 sourcePath+targetRoot+name）；action=uninstall 卸载（purge=true 连安装记录一并删除）。'
      + '启动时的自动检查只检查不安装（config.skill.autoCheck）；安装与更新只能由本工具显式触发。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: '操作：install | update | status | deploy | uninstall',
      },
      force: {
        type: 'boolean',
        description: '仅 update：允许降级安装（默认 false = 拒绝降级）。',
      },
      cwd: {
        type: 'string',
        description: '可选：项目根（installDir 未配置时按「最近含 .git 的祖先」解析落点根）。',
      },
      purge: {
        type: 'boolean',
        description: '仅 uninstall：是否连安装记录（meta.json）一并删除（默认 false = 保留记录）。',
      },
      sourcePath: {
        type: 'string',
        description: '仅 deploy：本地源目录（如仓库 skills/review-daily-summary/）。',
      },
      targetRoot: {
        type: 'string',
        description: '仅 deploy：落点根（自产 skill = <dataRoot>/agent/skills）。',
      },
      name: {
        type: 'string',
        description: '可选：skill 目录名（默认 tdx-tq-local；deploy 必填）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', description: '回显 action' },
          outcome: { type: 'string', description: '结果（installed/up-to-date/source-unreachable/uninstalled/nothing-to-do/…）' },
          version: { type: 'string', description: '安装/检测到的版本' },
          path: { type: 'string', description: '落点路径（SKILL.md 所在目录）' },
          warnings: { type: 'array', description: '警告清单' },
          residue: { type: 'array', description: '残留路径清单（正常为空）' },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const v = value as ManageView
        const lines = [`tq_skill_manage（${v.action}）：${v.outcome}`]
        if (v.version !== null) lines.push(`版本：${v.version}`)
        if (v.path !== null) lines.push(`路径：${v.path}`)
        for (const w of v.warnings) lines.push(`警告：${w}`)
        for (const r of v.residue) lines.push(`残留：${r}`)
        return [{ type: 'text' as const, text: lines.join('\n') }]
      },
    },
    execute: async (args: unknown) => runTqSkillManage(facades, config, args as never) as never,
  })
}

/** 装配（4.2/4.3）：注册工具 + 挂 skill 服务面 + autocheck 异步接线。 */
export function registerSkillInstaller(ctx: Context, config: ResolvedTraderKitConfig, facades: TqSkillFacades = defaultTqSkillFacades()): void {
  const api = ctx.traderKit
  if (api === undefined) {
    throw new Error('registerSkillInstaller 必须在 registerData 之后调用（ctx.traderKit 未挂载）')
  }

  const disposers = [ctx.tools.register(createTqSkillManageTool(facades, config))]
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-trader-kit: tq_skill_manage')

  const skillApi: SkillServiceApi = {
    status: async (input = {}) => {
      try {
        return await facades.buildSkillStatus({
          cwd: input.cwd,
          installDir: config.skill.installDir,
          minVersion: config.skill.minVersion,
          extraSkillRoots: config.skill.extraSkillRoots,
        })
      } catch (cause) {
        return degradedStatus(config, cause)
      }
    },
    deployLocalDir: (input) => facades.syncLocalDir(input),
  }
  ;(api as { skill?: unknown }).skill = skillApi

  // autocheck（3.2）：挂载后异步一次；只检查不安装；失败不阻塞、仅日志。
  ctx.effect(() => {
    void runAutoCheck({
      installDir: config.skill.installDir,
      sourceUrl: config.skill.sourceUrl,
      autoCheck: config.skill.autoCheck,
      checkIntervalHours: config.skill.checkIntervalHours,
    }).catch(() => {})
    return () => {}
  }, 'dsh-trader-kit: skill autocheck')
}
