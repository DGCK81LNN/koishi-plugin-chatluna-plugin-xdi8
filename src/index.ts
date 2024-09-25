import { Context, Schema } from "koishi"
import { ChatLunaPlugin } from "koishi-plugin-chatluna/services/chat"
import {
  fuzzyQuery,
  getMessageContent,
} from "koishi-plugin-chatluna/utils/string"
import type {} from "koishi-plugin-xdi8"

import { Tool } from "@langchain/core/tools"
import type { Alternation } from "xdi8-transcriber"

export const name = "chatluna-plugin-xdi8"
export const inject = ["chatluna", "xdi8"]

export const Config = Schema.object({})
export interface Config {}

export function apply(ctx: Context, config: Config) {
  const plugin = new ChatLunaPlugin(
    ctx,
    ChatLunaPlugin.Config(),
    "plugin-xdi8",
    false
  )

  ctx.on("ready", () => {
    plugin.registerToService()
    plugin.registerTool("hanzi_to_xdi8", {
      selector(history) {
        ctx.logger.debug("select")
        return history.slice(-10).some((item) => {
          const content = getMessageContent(item.content)
          return fuzzyQuery(content, ["希顶", "xdi8", "shidinn"])
        })
      },
      async createTool(params, session) {
        return new HanziToXdi8Tool(ctx)
      },
    })
  })
}

function normalizePunctuation(text: string) {
  return text.replace(
    /([。！，：；？…]+)(\s?)/g,
    (_, c, w) =>
      c.replace(
        /……|./g,
        (h: string) =>
          ({ "。": ".", "…": "...", "……": "..." }[h] ??
          String.fromCharCode(h.charCodeAt(0) - 0xfee0))
      ) + (w || " ")
  )
}

export class HanziToXdi8Tool extends Tool {
  name = "hanzi_to_xdi8"
  description =
    "This takes a piece of Chinese text and tries to translate it, " +
    "character by character, to Shidinn, and returns the result in Chat Alphabet. " +
    "Input must be in Simplified Chinese. Untranslatable characters are kept as is." +
    "When different translations are possible for a single Chinese character, " +
    "one is picked while a footnote indicating all possible translations for the character is provided. " +
    "Carefully examine each footnote. " +
    "Replace the word with another translation from the footnote if the automatically picked one seems incorrect."

  constructor(private ctx: Context) {
    super()
  }

  async _call(input: string) {
    try {
      this.ctx.logger.debug("call", input)
      let result = this.ctx.xdi8.hanziToXdi8Transcriber.transcribe(input, {
        ziSeparator: " ",
      })
      result = result.flatMap((seg) => {
        if (Array.isArray(seg)) {
          let newSeg = seg.filter((alt) => !alt.legacy)
          if (newSeg.length) seg = newSeg
          if (seg.length <= 1) return seg[0]?.content ?? "[ERROR]"
        }
        return [seg]
      })
      const alts: (Alternation[] & { $: string })[] = []
      const translation = result
        .map((seg) => {
          if (typeof seg === "string") return normalizePunctuation(seg)
          if (Array.isArray(seg)) {
            const source = seg[0].content.map((seg) => seg.h).join("")
            let seq = alts.findIndex((s) => s.$ === source) + 1
            if (seq === 0) seq = alts.push(Object.assign(seg, { $: source }))
            return seg[0].content.map((seg) => seg.v).join("") + `[^${seq}]`
          }
          return seg.v
        })
        .join("")
        .trimEnd()
      const footnotes = alts.map((seg, i) => {
        const source = seg.$
        const alts = seg.map((alt) => {
          let line = `* ${alt.content.map((seg) => seg.v).join("")}`
          if (alt.note) line += ` (${alt.note.replace(/\n/g, ". ")})`
          return line
        })
        return (
          `${i + 1}. "${source}" possible translations:\n` + alts.join("\n")
        )
      })
      let response = "Translation: " + translation
      if (alts.length) response += "\n\nFootnotes:\n" + footnotes.join("\n")
      this.ctx.logger.debug("response", response)
      return response
    } catch (e) {
      this.ctx.logger.error(e)
      return "An unknown error occurred"
    }
  }
}
