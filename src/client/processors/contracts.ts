/** 当前安装管理槽subject最小结构镜像；不引入宿主客户端类型包。 */
export interface PluginPackageRef { readonly name: string; readonly version?: string }
export type KeywordManagementSubject =
  | { readonly kind: 'bundle'; readonly pkg: PluginPackageRef }
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'row'; readonly pkg: PluginPackageRef; readonly row: { readonly rowId: string; readonly moduleName: string; readonly enabled: boolean } }
export interface KeywordRunsSectionProps { readonly subject: KeywordManagementSubject }
export type { PublicWorkflowRunDTO, WorkflowRunEvent, PublicMention, PublicWorkflowDefinition, PublicTaskDTO, KeywordTaskEvent, ParsedMentions } from '../../review/processors/types.ts'
