# Plato — Product Specification (v1.1)

*Date: 2026-11-26.* This document describes what v1.1 adds to and changes in [Plato v1](../v1/product-specification.md), from the learner's side. It covers flow and requirements, not how v1.1 is built. Where the two disagree, this document wins. Everything else works as in v1.

- **Conventions.** *Italics* mark statuses. **Bold** marks lead-ins, terms and OpenAI's required labels (F10). Actions are described, not named. Other wording, labels and layout are for the wireframes.
- **References.**
  - Plato v1: [product specification](../v1/product-specification.md), [technical design](../v1/technical-design.md), [course pipeline](../v1/course-pipeline.md), [wireframes](../v1/wireframes/index.html).
  - OpenAI, Sign in with ChatGPT: [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines), [website sign-in](https://developers.openai.com/siwc/website), [plan usage for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

---

## 1. Overview

v1.1 adds three things.

1. **Your ChatGPT plan, in Plato.** You connect your ChatGPT account once, and Plato's AI work runs on your plan's usage. Later AI features build on this connection and follow the rules in F12.
2. **One AI feature: building courses in the app.** This tests the connection with real work. Plato builds the course you request in the background, with visible progress, and publishes it with no operator step or deploy.
3. **One course builder.** An agent with six fixed stages, each ending in a gate, used by both the app and the operator (§10).

---

## 2. Principles

v1's principles hold, with one replaced and three added.

- **v1 principle 2 (replaced). AI works ahead of you, never in your way.** Nothing that learning needs waits on a model. AI runs in the background, or only when you ask for it. Without AI, learning works as in v1.
- **9. Your plan, your control.** Plato shows when work uses your ChatGPT plan. It uses no other way of paying, and uses your plan only for work you started.
- **10. Visible progress.** Long-running work shows where it is, what it is doing, and when it last made progress. Stalled work says so.
- **11. Continue, don't restart.** Interrupted work picks up where it stopped. At most, the one build step that was running is repeated.

---

## 3. Scope

| Dimension | v1.1 |
|---|---|
| Learner | One learner, as in v1. The passcode still protects Plato. ChatGPT is connected only for AI usage, not to sign in to Plato. |
| Distribution | Open source and self-hosted: each learner runs their own Plato, locally or on their own server. |
| AI usage | The connected ChatGPT account's plan. One account is active in the app at a time. |
| AI features | Course building (F11). |
| Course creation | One course builder, started by the learner in the app or by the operator from the command line (§10). |
| Not in v1.1 | Answer polishing, tutor chat and other AI features. Plato's own API key or credits. More than one active account. Notifications outside the app. |

---

## 4. Terms

New and changed terms. Other terms are as in v1.

| Term | Meaning |
|---|---|
| **ChatGPT connection** | The link that lets Plato use your ChatGPT plan. Status: *Not connected*, *Connected*, *Plan usage off*, *Needs reconnecting*, *Not eligible* (F10). |
| **Plan usage** | AI work that counts against your ChatGPT plan's limits. You manage those limits in ChatGPT, not in Plato. |
| **AI entry point** | Any action that starts AI work: requesting a course, building a saved request, continuing a paused build, or starting a build over (F11, F12). |
| **Course builder** | The agent that turns a request into a course (§10). |
| **Build** | One run of the course builder on one request. Status: *Queued*, *Building*, *Paused*, *Done*, *Not built* (F11). |
| **Stage** | One of a build's six stages, in order: Key questions, Scope, Research, Write, Check, Publish. Status: *Waiting*, *Running*, *Fixing* (a gate attempt failed and the stage is trying again), *Passed*, *Failed*. |
| **Gate** | The checks that a stage's output must pass before the next stage starts (§10). |
| **Build step** | One model request or one tool use within a stage. Not the same as v1's lesson steps. |
| **Activity log** | A build's record of its build steps (F11). |
| **Course request** | Changed. Status: *Not started*, *Building*, *Published* or *Not built*. A request is *Building* while its build is *Queued*, *Building* or *Paused*. It becomes *Published* when the build is *Done*, *Not built* when the build is *Not built*, and *Not started* again if the build is cancelled. Starting over makes a *Not built* request *Building* again; cancelling that returns it to *Not built*. |
| **Shell page** | Anywhere in Plato outside the player. |
| **Player** | Where you do sessions, lessons, reviews and checkpoints. |
| **Operator** | Whoever runs Plato's command-line tools: the person who self-hosts it, often the learner. |

---

## 5. Journey

1. **Connect** (once): connect your ChatGPT account (F10).
2. **Request**: describe what you want to learn (v1 F1). When *Connected*, sending the request starts or queues its build.
3. **Build** (in the background): you can follow progress from any shell page, or leave (F11).
4. **Ready**: the course is *Ready*, as in v1.
5. **Learn, check, complete, retain**: as in v1.

---

## 6. Features

### F10. ChatGPT connection

You manage the connection from any shell page. It is in one of these states:

| Status | How you get here | What you're told |
|---|---|---|
| *Not connected* | Never connected, or disconnected | OpenAI's plan offer (below), and what connecting shares: your email and profile, and plan usage, but never your conversations ([plan usage for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source)) |
| *Connected* | Connected, with plan usage allowed | Which account is connected, and the usage indicator |
| *Plan usage off* | You signed in but didn't allow plan usage, or Plato's access no longer includes it | Which account, and that Plato can't use its plan until you allow it |
| *Needs reconnecting* | ChatGPT stopped accepting Plato's access: you removed Plato in ChatGPT, it was revoked, or it expired after Plato went unused for a long time | That Plato lost access to the account |
| *Not eligible* | ChatGPT refused plan usage for this account or workspace, or because of a policy such as the serving region ([errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)). Plato learns this only when it first tries to use the plan. | That ChatGPT doesn't allow this account's plan to be used here |

- **Connecting** takes you to ChatGPT to choose an account and workspace and approve, then back to Plato. If you cancel, nothing is connected.
- **Allowing plan usage** (from *Plan usage off*) and **reconnecting** (from *Needs reconnecting*) take you to ChatGPT to approve again, then back to Plato. Reconnecting goes to the same account.
- *Needs reconnecting* is set only when ChatGPT refuses Plato's access, never on a network failure.
- **Checking again** (from *Not eligible*) has Plato try the plan once more, for example after a plan change.
- **Switching account** (from *Connected* or *Not eligible*) takes you to ChatGPT to choose another account. The current account stays active until the new one connects. When it does, a running build pauses (F11).
- **Disconnecting** (from any status but *Not connected*) pauses a running build and keeps built courses. You're told this first, and that Plato's access ends fully only when you remove Plato in ChatGPT settings ([profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)).
- **Model.** Plato chooses from the models the account offers. There is no model setting.

#### OpenAI's requirements

Plato follows OpenAI's [UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines), using the labels they set exactly: **Continue with ChatGPT**, **Using ChatGPT plan** and **Manage usage**.

- **Plan offer**, in *Not connected*: invites you to use your ChatGPT plan, with **Continue with ChatGPT** in OpenAI's approved branding, with the ChatGPT logo ([website sign-in](https://developers.openai.com/siwc/website)).
- **First-use notice**, once, the first time plan usage is on: says that eligible usage now uses your plan and is managed in ChatGPT settings. You dismiss it.
- **Usage indicator**: **Using ChatGPT plan**, with **Manage usage** opening [ChatGPT's usage settings](https://chatgpt.com/settings/usage).
- **Usage limit message**: says that your plan's usage, or a limit you set for Plato in ChatGPT settings, has run out. **Manage usage** is its main action. It gives no reset time, since ChatGPT reports none ([errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)).

### F11. Building a course in the app

#### Starting a build

- **When *Connected*:** sending a request (v1 F1) starts or queues its build.
- **Otherwise:** the request is saved as *Not started*, as in v1, and you're told what to fix (F12 rule 1).

You can build any *Not started* request later, with the same rules.

#### One at a time

Plato runs one build at a time, in the order started. A *Paused* build keeps its place, so the builds behind it wait. A queued build whose turn comes while Plato isn't *Connected* pauses for that reason.

#### Build statuses

| Status | Meaning | What you can do |
|---|---|---|
| *Queued* | Waiting for another build to finish | Cancel |
| *Building* | A stage is running | Cancel |
| *Paused* | The build can't continue until something changes. You're always told why (below). | The action for its reason (next table), or cancel |
| *Done* | Published | Open the course |
| *Not built* | Plato decided not to build the course, or a gate failed on its last attempt (§10). You're given a one-line reason. | Start over (after a failed gate only) |

| Paused because | What you can do | What happens next |
|---|---|---|
| Usage ran out | **Manage usage**, then continue | The build continues. If the limit is still reached, it pauses again at once. Plato doesn't retry on its own. |
| The connection is *Needs reconnecting*, *Not connected* or *Plan usage off* | Reconnect, connect or allow plan usage (F10) | If the same account is connected, the build continues on its own. Otherwise, as for a different account (below). |
| The connection is *Not eligible* | Check again, or switch account | If the account is now eligible, the build continues on its own. After a switch, as for a different account (next row). |
| A different account is now connected | Continue | You're told which account the build started on. The build moves to the new account only when you choose to continue. |
| ChatGPT was unavailable for longer than a brief outage, or Plato restarted during a build step that can't safely be repeated without your go-ahead | Continue | The build continues |

- **Starting over** starts a new build of the request from the first stage. You're told first that it uses your plan again.
- **Cancelling** discards the build. The request returns to *Not started*, or to *Not built* with its reason if the build was a start-over. You're told first that usage already spent isn't returned.
- **Outages and restarts.** After a brief ChatGPT outage, or a restart of Plato during a build step that can safely be repeated, the build stays *Building* and continues on its own. The activity log records each retry. What counts as brief, and which steps can be repeated, is set in the technical design.

#### Keeping you informed

- **While a build runs**, every shell page shows that a build is queued or in progress, or *Paused* and needing you. A request shows its build's status. Shown progress never goes backwards, even while a stage is *Fixing*.
- **When a build ends or pauses**, you learn of it, or on your next visit if you weren't in Plato.
- **Never in the player.** News about builds waits until you leave it.

#### The build page

Each build has a page that shows:

- **Status**: the request, the build's status and how long it has run, with its actions.
- **Stages**: each stage's status, including when a stage is *Fixing*.
- **Current activity**: what the build is doing now, and how long ago it last made progress, with the cause of a stall if known.
- **Results**: each stage's result once the stage passes.
- **Activity log**: in plain language, including problems found and each fix attempt. It never shows tokens or account identifiers.

It updates live, announces status changes to screen readers, and stays available after the build ends.

### F12. Rules for every AI entry point

Every AI feature follows these rules.

1. **Visible but optional.** An AI entry point is available in every connection status. If the status isn't *Connected*, it leads to the fix.
2. **Say whose usage it is.** When *Connected*, the usage indicator accompanies every entry point.
3. **The same limit message everywhere.** When usage runs out, the entry point shows the usage limit message (F10). Besides **Manage usage**, the only other actions are continuing or cancelling paused work.
4. **Fail soft.** If AI work fails, Plato keeps what you typed, tells you briefly what happened, and offers to try again.
5. **Send only what's needed.** Plato never sends your progress, notes or answers, unless you started a feature about them.

---

## 9. Changes to v1

v1 [§7 Content quality](../v1/product-specification.md#7-content-quality) and [§8 Content policies](../v1/product-specification.md#8-content-policies) are unchanged.

| v1 | Change in v1.1 |
|---|---|
| [§1](../v1/product-specification.md#1-overview) "Plato calls no AI model while you use it. Every course is created offline", and [principle 2](../v1/product-specification.md#2-principles) | Replaced by the new principle 2 (§2). Courses can also be built in the app (F11). |
| [§4](../v1/product-specification.md#4-terms) Course request | *Requested* is renamed *Not started*, the *Building* status is added, and a *Not built* request can be built again after a failed gate (§4, F11). |
| [§5](../v1/product-specification.md#5-journey) Journey, "Creation (offline)" | Connect, then build in the background (§5). |
| [F1](../v1/product-specification.md#f1-course-request) Course request | When *Connected*, a request starts a build. Saved requests can be built later, and failed builds started over (F11). |
| [F2](../v1/product-specification.md#f2-course-creation) Course creation | Done by the course builder (§10), in the app or offline, with the same stages and quality requirements (v1 §7). |
| [F8](../v1/product-specification.md#f8-today-and-reviews) Today | Shows *Building* requests with their status (F11). |
| [F9](../v1/product-specification.md#f9-course-page-and-library) Course page and library | The Library shows *Building* requests with their status. |
| [v1 course pipeline §2](../v1/course-pipeline.md#2-stages) | The course builder replaces the course-creation skill. Every gate gets three attempts, not only Write and Check, and in the app Publish has a new gate (§10). |

---

## 10. The course builder

|  | In the app | For the operator |
|---|---|---|
| Who starts it | The learner (F11) | The operator, with one command per request. The export, publish and not-built commands stay ([v1 technical design §11.5](../v1/technical-design.md#115-what-the-operator-runs)). |
| Whose AI usage | The app's connected ChatGPT plan | The operator's own ChatGPT connection, separate from the app's |
| Progress | The build page (F11) | The same stages and activity log, in the terminal |
| Publishing | At once, when the Publish gate passes | As in v1: a PR, merged when CI is green, then deployed. Until it is deployed, the request stays *Not started*. |

A request is built in one place at a time. One that is *Building* in the app is left out of the operator's export, and one the operator has exported can't be built in the app until the operator publishes it or marks it not built.

Wherever it runs:

- **Fixed stages, in order.** A stage ends when its gate passes, not when the model says it is done.
- **Gates.** v1's gates for each stage ([v1 pipeline §2](../v1/course-pipeline.md#2-stages)), unchanged. In the app, Publish's gate (green CI in v1) is instead that every earlier check passes on the course exactly as it will be published.
- **Bounded attempts.** Each gate gets three attempts, counting the first. If the last attempt fails, the build is *Not built*, with a one-line reason. Key questions can also decide not to build, as in v1.
- **Observable and durable.** Every build step adds a line to the activity log, and progress is saved after it.
- **Same rules, not same text.** Two builds of one request meet the same rules, but their outline and wording may differ.

The technical design decides whether the builder runs on an existing agent runtime or one Plato writes, and gives the agent's detailed design.

---

## 11. Open risks

The technical design resolves these and records any change to F10 or F11 in this document.

1. **Connecting a Plato on a server.** ChatGPT's sign-in returns to the computer you sign in on. A Plato on a server would need you to connect on your own computer and copy the connection over, and ChatGPT can't yet revoke a copied connection on its own ([self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)).
2. **Builds while you're away.** If long builds can't run with no browser open, builds pause more often, or you must keep Plato open in a browser.
