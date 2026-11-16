# Issue 提交指引 / How to file an issue

> 本仓库的 issue 会被自动分析：机器人会定位相关代码、给出原因和修复方案，维护者确认后由它改码并开 PR。
> 所以**写得越像一张工单，处理得越快**；写得含糊就只能来回问。
>
> Issues here get analysed automatically: a bot locates the relevant code, works out the cause and proposes a fix.
> The clearer your report, the faster it goes — vague reports only cost you a round of questions.

**English readers:** every section has an English paragraph below the Chinese one. You can also skip this page and use the
[**structured bug form**](https://github.com/DC1024/rolecard-studio/issues/new?template=bug-report.yml) directly — it asks the same
four questions, with examples.

---

## 提之前，30 秒自检 / 30-second check

1. **是 bug 还是用法问题？** 「怎么用 X」请先看 [README](README.md) 与 [wiki/](wiki/Home.md)；issue 只收「本该正常却没正常工作」的问题。
   *Bug or usage question? "How do I use X" belongs in the docs or Discussions. Issues are for things that should work but don't.*
2. **能一句话说清「哪里、点了什么、看到了什么」吗？** 说不清就先别发，多数时候是还没看清现象。
   *Can you say what you clicked and what you saw, in one sentence? If not, you probably haven't pinned the symptom down yet.*
3. **能让别人照着做一遍、看到同样的问题吗？** 这是最关键的一条。
   *Can someone else repeat your steps and see the same thing? This is the single most important part.*
4. **一个 issue 只讲一件事。** 三个不相关的问题请发三次。
   *One issue, one problem. Three unrelated bugs need three issues.*

---

## 四段式 / The four-part template

复制这段，填完再发。不需要技术名词 —— 用你平时说话的方式写就行。
*Copy this, fill it in, post it. No technical vocabulary needed — write the way you'd explain it to a friend.*

```markdown
## 现象 / What happened

<你点了什么，看到了什么。有报错就原样贴出来。>
<What you clicked, and what you saw. Paste any error message as-is.>

## 怎么重现 / Steps to reproduce

1.
2.
3.

## 本来应该是怎样 / What you expected

<一两句话就够。>

## 怎样算修好（可选）/ How to know it's fixed (optional)

- [ ] 按上面步骤再操作一次，问题不再出现
- [ ] 其他功能没有被弄坏
```

---

## 每一段为什么重要 / Why each part matters

| 段落 / Part | 它决定了什么 / What it decides | 漏了会怎样 / If it's missing |
|---|---|---|
| 现象 + 原样的报错文字<br>*Symptom, with the exact wording* | 能不能定位到哪一块出了问题<br>*Whether we can find the right area* | 大概率只能回你一句「请补充信息」<br>*You get "please add more detail" and nothing else* |
| 怎么重现<br>*Steps* | 能不能确认问题真的存在<br>*Whether the problem can be confirmed* | 分析要多绕好几轮，甚至判断不了<br>*Several extra rounds, or no conclusion at all* |
| 本来应该是怎样<br>*Expectation* | 修的方向对不对<br>*Whether the fix aims at the right thing* | 可能「修好了」但并不是你要的<br>*It gets "fixed" into something you didn't want* |
| 怎样算修好<br>*Acceptance* | 改到什么程度算完成<br>*When the work counts as done* | 改动可能不带验证<br>*The change may ship without verification* |

> **截图不能代替文字。** 图里的字没法被搜索、也没法被引用；请把关键内容抄成文字或代码块。
> *A screenshot can't replace text — it can't be searched or quoted. Copy the key lines into the box.*

---

## 好例子 / A good example

下面这个例子是**虚构的**，只用来示范写法 —— 请换成你自己真实遇到的情况。
*The example below is made up. It only shows the shape of a good report — replace it with your own case.*

```markdown
## 现象 / What happened

我在「快速试聊」里输入了一句话，点了发送，等了十几秒都没有回复。
页面上没有任何提示，输入框也还在，就好像按了没反应。

I typed a message in Quick Test Chat and pressed Send. Nothing came back for
more than ten seconds. No error, no spinner — the page just sat there.

## 怎么重现 / Steps to reproduce

1. 登录后点右上角的「设置」
2. 打开「模型槽位」，随便填一个模型，点「测试连接」
3. 按钮一直转圈，既不显示成功，也不显示失败

1. Sign in, click Settings in the top right corner
2. Open "Model Slots", pick any model, click "Test connection"
3. The button spins forever — neither success nor failure shows up

## 本来应该是怎样 / What you expected

点「测试连接」之后几秒内应该显示「连接成功」，而不是一直转圈。

After clicking "Test connection", it should say "Connected" within a few
seconds — instead of spinning forever with no message.

## 补充信息 / Anything else

v1.9.0，Chrome 浏览器，Windows 11；只有联网考据模式会这样。

v1.9.0, Chrome on Windows 11; only happens in online-research mode.
```

它好在哪里：说清了「点了什么 → 看到什么 → 本该如何」，不涉及一行代码，别人照着三步就能复现。
*Why it works: it says what was clicked, what was seen, and what should have happened — no code involved, and three steps reproduce it.*

---

## 会被打回的四类 / Four ways to get sent back

| 写法 / What people write | 为什么不行 / Why it fails | 怎么改 / What to do instead |
|---|---|---|
| 「XX 坏了，帮我看看」<br>*"X is broken, please look"* | 没有现象细节，无从下手<br>*No detail to work from* | 补：点了什么 → 看到什么 → 报错原文<br>*Add: what you clicked, what you saw, the exact error* |
| 「见截图」<br>*"See screenshot"* | 图里的字读不出来、搜不到<br>*Text in images can't be read or searched* | 把关键内容抄成文字<br>*Copy the key lines into text* |
| 一个 issue 塞 3 个不相关问题<br>*Three unrelated bugs in one issue* | 改动面太大，容易半途停下<br>*Too much surface area; work stalls halfway* | 拆成 3 个 issue<br>*Split into three issues* |
| 「顺便把这个也重构一下」<br>*"Also refactor this while you're here"* | 范围不可控，无法验证<br>*Unbounded scope, nothing to verify against* | 另开一个 issue，只讲重构目标<br>*Open a separate issue for the refactor* |

另外：**不要在 issue 里贴密码、密钥、账号。** 这类内容会被安全检查拦下，也会留在公开记录里。
*Also: never paste passwords, keys or account details — they trip security checks and stay in public history.*

---

## 提交之后 / What happens next

1. 维护者先看一遍，判断是否交给自动分析。
   *A maintainer reads it first and decides whether to hand it to the automated analysis.*
2. 确认后，分析结论（原因、涉及文件、修复方案、风险）**以评论形式发在这里**。
   *If accepted, the analysis — cause, files involved, proposed fix, risks — is posted as a comment on your issue.*
3. 如果开始自动修复，会先开一个 PR 并跑检查，通过后合并、关闭本 issue。
   *If a fix goes ahead, a PR is opened and checked; once it passes, it is merged and your issue is closed.*

分析一般在十分钟内出结论；维护者批准后，从改码到合入通常再需十分钟左右。
*Analysis usually lands within ten minutes; after approval, the change to merge takes roughly another ten.*
补充信息请直接在本 issue 下评论，不要另开新 issue。
*Add follow-up details as a comment on the same issue — please don't open a new one.*
