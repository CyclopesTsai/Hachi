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
import { msg } from '@shared/i18n'

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
        <DialogTitle>{msg().git.prompt[prompt.kind]}</DialogTitle>
        <DialogDescription className="break-all">{prompt.prompt.trim()}</DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        aria-label={msg().git.prompt[prompt.kind]}
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{msg().git.prompt.hint}</p>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => void useGitStore.getState().answerPrompt(null)}
        >
          {msg().common.cancel}
        </Button>
        <Button type="submit">{msg().common.ok}</Button>
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
