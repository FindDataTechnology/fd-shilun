// 7.3 视觉等价的**机器可验**部分：类名 golden 比对
//
// 7.3 原文要求"截图对比无明显结构差异"。截图需要人眼，这里做能机器判死的那一半：
// **以改前实现为 golden**，逐控件断言渲染出的 class 集合与 golden **完全相等**。
//
// golden 从哪来：改前 `ui.tsx` 的类名字面量（`git show HEAD~N:web/src/components/ui.tsx`
// 可复核）。集合相等意味着：既没有丢类（会变窄/变淡/丢边框），也没有多类
// （会多出 padding/背景/字重）。
//
// 这比人眼看更严的一点：人眼很难发现 `font-medium` 掉了、`px-2` 变 `px-2.5`；
// 但这两处都会让集合不等。仍**不能**替代真截图的部分：颜色值本身的正确性、
// 字体渲染、布局上下文（flex 容器里的收缩行为）——那部分留给人眼，已在 tasks.md 标注。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  CitationBadge,
  EmptyLine,
  ErrorBox,
  Loading,
  VerifyStatusBadge,
  WarnBadge,
} from './ui'

/** 从渲染结果里取第一个标签的 class 集合。 */
function classesOf(html: string): Set<string> {
  const m = html.match(/class="([^"]*)"/)
  if (!m) throw new Error(`渲染结果里没有 class：${html.slice(0, 120)}`)
  return new Set(m[1].split(/\s+/).filter(Boolean))
}

/** 集合相等断言，失败时打印双向差集（只说"不相等"没法排查）。 */
function expectSameClasses(html: string, golden: string[]) {
  const got = classesOf(html)
  const want = new Set(golden)
  const missing = [...want].filter((c) => !got.has(c))
  const extra = [...got].filter((c) => !want.has(c))
  expect({ missing, extra }).toEqual({ missing: [], extra: [] })
}

describe('7.3 golden：改前后 class 集合逐控件相等（fd-shilun）', () => {
  it('Loading', () => {
    expectSameClasses(renderToStaticMarkup(<Loading />), [
      'animate-pulse',
      'text-sm',
      'text-neutral-400',
    ])
  })

  it('EmptyLine', () => {
    expectSameClasses(renderToStaticMarkup(<EmptyLine>空</EmptyLine>), [
      'text-sm',
      'text-neutral-400',
    ])
  })

  it('ErrorBox（盒子本体）', () => {
    expectSameClasses(renderToStaticMarkup(<ErrorBox message="boom" />), [
      'rounded-lg',
      'border',
      'border-red-200',
      'bg-red-50',
      'px-4',
      'py-3',
      'text-sm',
      'text-red-800',
    ])
  })

  it('CitationBadge', () => {
    expectSameClasses(renderToStaticMarkup(<CitationBadge id="c1" />), [
      'inline-flex',
      'items-center',
      'rounded-full',
      'border',
      'shrink-0',
      'px-2',
      'py-0.5',
      'text-xs',
      'border-neutral-300',
      'bg-white',
      'text-neutral-600',
    ])
  })

  it('WarnBadge', () => {
    expectSameClasses(renderToStaticMarkup(<WarnBadge />), [
      'inline-flex',
      'items-center',
      'rounded-full',
      'border',
      'shrink-0',
      'px-2',
      'py-0.5',
      'text-xs',
      'border-amber-300',
      'bg-amber-50',
      'text-amber-800',
    ])
  })

  it('VerifyStatusBadge × 三态（pass / block / pending_review）', () => {
    const base = [
      'inline-flex',
      'items-center',
      'rounded-full',
      'border',
      'shrink-0',
      'px-2',
      'py-0.5',
      'text-xs',
    ]
    expectSameClasses(renderToStaticMarkup(<VerifyStatusBadge status="pass" />), [
      ...base,
      'border-green-300',
      'bg-green-50',
      'text-green-800',
    ])
    expectSameClasses(renderToStaticMarkup(<VerifyStatusBadge status="block" />), [
      ...base,
      'border-red-300',
      'bg-red-50',
      'text-red-800',
    ])
    expectSameClasses(renderToStaticMarkup(<VerifyStatusBadge status="pending_review" />), [
      ...base,
      'border-amber-300',
      'bg-amber-50',
      'text-amber-800',
    ])
  })

  it('未知核验状态沿用旧兜底（仅边框色）', () => {
    // @ts-expect-error 故意传非法值，验证运行时兜底
    const html = renderToStaticMarkup(<VerifyStatusBadge status="weird" />)
    const got = classesOf(html)
    expect(got.has('border-neutral-300')).toBe(true)
    expect([...got].some((c) => c.startsWith('bg-'))).toBe(false)
  })
})
