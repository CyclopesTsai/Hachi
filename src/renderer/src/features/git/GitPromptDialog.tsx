import { useState, type FormEvent } from 'react'
import type { GitPrompt } from '@shared/git'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useGitStore } from '@renderer/stores/git-store'

const TITLES: Record<GitPrompt['kind'], string> = {
  username: 'Git 需要帳號',
  password: 'Git 需要密碼或 Token',
  passphrase: '需要 SSH 金鑰的密語',
  other: 'Git 詢問'
}

function PromptForm({ prompt }: { prompt: GitPrompt }) {
  const [value, setValue] = useState('')
  const secret = prompt.kind === 'password' || prompt.kind === 'passphrase'

  function submit(e: FormEvent): void {
    e.preventDefault()
    void useGitStore.getState().answerPrompt(value)
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{TITLES[prompt.kind]}</DialogTitle>
        <DialogDescription className="break-all">{prompt.prompt.trim()}</DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        aria-label={TITLES[prompt.kind]}
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        只傳給這次的 git 指令，Hachi 不會儲存；要不要記住由 git 的 credential helper（例如 macOS
        鑰匙圈）決定。 GitHub 等服務請使用 Personal Access Token 而不是登入密碼。
      </p>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => void useGitStore.getState().answerPrompt(null)}
        >
          取消
        </Button>
        <Button type="submit">確定</Button>
      </DialogFooter>
    </form>
  )
}

/** git needs a username / password / passphrase (decision 113, GIT_ASKPASS). */
export function GitPromptDialog() {
  const prompt = useGitStore((s) => s.prompts[0] ?? null)
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(o) => !o && void useGitStore.getState().answerPrompt(null)}
    >
      <DialogContent data-testid="git-prompt-dialog">
        {prompt && <PromptForm key={prompt.id} prompt={prompt} />}
      </DialogContent>
    </Dialog>
  )
}
