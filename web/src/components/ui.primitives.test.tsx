// 状态控件已改用共享壳原语（change lex-web-shell-convergence 5.3）
//
// 这条哨兵守三件容易被无声破坏的事：
//   1. **替换是真的**：`ui.tsx` 必须从 `kit/primitives` 导入，且不再自己拼
//      `rounded-full border …` 的 pill 外壳（否则就是"两套实现并存"，
//      抽取白做了，而且下次改原语这套不会跟着变）；
//   2. **视觉不漂移**：每个控件的尺寸/间距/字重/配色类名必须仍是宿主的原值——
//      抽取的第一要求是替换后像素一致，类名丢了就是静默的界面变化；
//   3. **a11y 只增不减**：错误态要 role=alert、加载态要 role=status。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { ErrorBox, Loading, WarnBadge, CitationBadge, VerifyStatusBadge, EmptyLine } from './ui'

const UI_SRC = readFileSync(join(__dirname, 'ui.tsx'), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const UI_CODE = stripComments(UI_SRC)

describe('ui.tsx 已换用原语', () => {
  it('从 kit/primitives 导入状态类原语', () => {
    expect(UI_CODE).toMatch(/from\s+['"]\.\.\/kit\/primitives\/index['"]/)
    for (const name of ['LoadingState', 'ErrorState', 'EmptyState', 'StatusPill']) {
      expect(UI_CODE, `未导入 ${name}`).toContain(name)
    }
  })

  it('不再自己拼 pill 外壳（避免两套实现并存）', () => {
    // 旧实现的特征：span 上直接写 rounded-full 类名
    const rawPills = [...UI_CODE.matchAll(/<span[^>]*className=\{?[`'"][^>]*rounded-full/g)]
    expect(rawPills.length, '仍有自造 pill 外壳').toBe(0)
  })

  it('DegradeBox 保持宿主自有（诚实降级契约不并入通用错误态）', () => {
    expect(UI_CODE).toMatch(/export function DegradeBox/)
    expect(UI_CODE).not.toMatch(/DegradeBox[\s\S]{0,200}ErrorState/)
  })
})

describe('视觉类名仍是宿主原值', () => {
  it('加载态与空态沿用 text-neutral-400 系，不是原语的 opacity 兜底', () => {
    const loading = renderToStaticMarkup(<Loading />)
    expect(loading).toContain('animate-pulse')
    expect(loading).toContain('text-neutral-400')
    const empty = renderToStaticMarkup(<EmptyLine>空</EmptyLine>)
    expect(empty).toContain('text-neutral-400')
  })

  it('错误盒沿用 red-50/red-800 调色板', () => {
    const html = renderToStaticMarkup(<ErrorBox message="boom" />)
    expect(html).toContain('bg-red-50')
    expect(html).toContain('text-red-800')
    expect(html).not.toContain('--fd-error-bg') // 不该退到 CSS 变量兜底
  })

  it('徽标沿用 px-2 py-0.5 text-xs 与宿主配色', () => {
    const warn = renderToStaticMarkup(<WarnBadge />)
    expect(warn).toContain('px-2')
    expect(warn).toContain('py-0.5')
    expect(warn).toContain('bg-amber-50')
    const cite = renderToStaticMarkup(<CitationBadge id="c1" />)
    expect(cite).toContain('bg-white')
    expect(cite).toContain('text-neutral-600')
    const verify = renderToStaticMarkup(<VerifyStatusBadge status="pass" />)
    expect(verify).toContain('bg-green-50')
  })
})

describe('a11y 只增不减', () => {
  it('加载态 role=status，错误态 role=alert', () => {
    expect(renderToStaticMarkup(<Loading />)).toContain('role="status"')
    expect(renderToStaticMarkup(<ErrorBox message="x" />)).toContain('role="alert"')
  })

  it('401 时仍给出令牌提示', () => {
    const html = renderToStaticMarkup(<ErrorBox message="denied" code={401} />)
    expect(html).toContain('mt-1 text-xs')
  })
})
