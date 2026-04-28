/**
 * Manifest V3 background service worker.
 *
 * Responsibilities:
 * - Handle ADD_TO_PIPELINE messages from content scripts
 * - Orchestrate the pipeline: create app → upload job desc → tailor CV
 * - Manage badge count (pending/recent applications)
 * - Alarm-based follow-up reminders
 * - Push notifications for pipeline events
 */

import { browser } from "../lib/browser"
import { createClientFromStorage } from "../lib/api-client"
import { ALARM_INTERVALS, ALARM_NAMES } from "../lib/constants"
import {
  getRecentApplications,
  getSettings,
  prependApplication,
} from "../lib/storage"
import type {
  AddToPipelinePayload,
  Application,
  ExtensionMessage,
  PipelineProgressPayload,
  PipelineResult,
} from "../lib/types"

// ---------------------------------------------------------------------------
// Badge management
// ---------------------------------------------------------------------------

async function updateBadge(): Promise<void> {
  const settings = await getSettings()
  if (!settings.badgeEnabled) {
    browser.action.setBadgeText({ text: "" })
    return
  }

  try {
    const client = await createClientFromStorage()
    const apps = await client.listApplications("applied")
    const count = apps.length

    browser.action.setBadgeText({ text: count > 0 ? String(count) : "" })
    browser.action.setBadgeBackgroundColor({ color: "#7c3aed" })
  } catch {
    browser.action.setBadgeText({ text: "" })
  }
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

function notify(
  title: string,
  message: string,
  type: chrome.notifications.TemplateType = "basic"
): void {
  const id = `cv-pipeline-${Date.now()}`
  browser.notifications.create(id, {
    type,
    iconUrl: browser.runtime.getURL("icons/icon-48.png"),
    title,
    message,
  })
}

// ---------------------------------------------------------------------------
// Send progress to active tabs matching job board patterns
// ---------------------------------------------------------------------------

async function sendProgressToTabs(payload: PipelineProgressPayload): Promise<void> {
  const tabs = await browser.tabs.query({ active: true })
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      browser.tabs
        .sendMessage(tab.id, {
          type: "PIPELINE_PROGRESS",
          payload,
        } satisfies ExtensionMessage<PipelineProgressPayload>)
        .catch(() => {
          // Tab may not have content script — ignore
        })
    }
  }
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

async function runPipeline(
  payload: AddToPipelinePayload
): Promise<PipelineResult> {
  const { job } = payload
  const client = await createClientFromStorage()

  // Step 1: Create application
  await sendProgressToTabs({ step: "creating", message: "Creating application..." })

  const application: Application = await client.createApplication({
    company: job.company,
    position: job.position,
    url: job.url,
  })

  try {
    await sendProgressToTabs({
      step: "uploading",
      applicationName: application.name,
      message: "Uploading job description...",
    })

    // Step 2: Upload job description as a file (job-description.txt)
    if (job.description) {
      await client.uploadFile(
        application.name,
        job.description,
        "job-description.txt"
      )
    }

    // Step 3: Trigger tailor action
    await sendProgressToTabs({
      step: "tailoring",
      applicationName: application.name,
      message: "Tailoring CV — this may take a moment...",
    })

    const actionResult = await client.executeAction(
      "tailor",
      application.name
    )

    // Step 4: Done
    await sendProgressToTabs({
      step: "done",
      applicationName: application.name,
      jobId: actionResult.job_id,
      message: `CV tailored for ${job.company}!`,
    })

    // Cache locally
    await prependApplication(application)

    return { application, jobId: actionResult.job_id }
  } catch (err) {
    // Error recovery: clean up orphaned application
    try {
      await client.updateApplication(application.name, { status: "rejected" })
    } catch {
      // If update fails, the app remains in "applied" — user can clean up manually
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Follow-up reminder check
// ---------------------------------------------------------------------------

const NOTIFIED_STALE_APPS = new Set<string>()

async function checkFollowups(): Promise<void> {
  const settings = await getSettings()
  if (!settings.notificationsEnabled) return

  try {
    const client = await createClientFromStorage()
    const apps = await client.listApplications("applied")

    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    let notifiedCount = 0
    const MAX_NOTIFICATIONS_PER_CYCLE = 3

    for (const app of apps) {
      if (notifiedCount >= MAX_NOTIFICATIONS_PER_CYCLE) break

      const createdAt = new Date(app.created_at).getTime()
      if (now - createdAt > sevenDaysMs && !NOTIFIED_STALE_APPS.has(app.name)) {
        notify(
          "Follow-up reminder",
          `No update for "${app.position}" at ${app.company}. Consider following up.`
        )
        NOTIFIED_STALE_APPS.add(app.name)
        notifiedCount++
      }
    }
  } catch {
    // API unreachable — skip silently
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener(
  (
    message: ExtensionMessage<unknown>,
    _sender,
    sendResponse: (response: unknown) => void
  ) => {
    switch (message.type) {
      case "ADD_TO_PIPELINE": {
        const payload = message.payload as AddToPipelinePayload
        runPipeline(payload)
          .then((result) => {
            sendResponse({ success: true, result })
            void updateBadge()
            notify(
              "Pipeline started",
              `Application created for ${payload.job.position} at ${payload.job.company}`
            )
          })
          .catch((err: unknown) => {
            const errMessage =
              err instanceof Error ? err.message : "Unknown error"
            sendResponse({ success: false, error: errMessage })
            notify("Pipeline failed", errMessage)
          })
        // Return true to keep the message channel open for async sendResponse
        return true
      }

      case "GET_RECENT_APPLICATIONS": {
        getRecentApplications()
          .then((apps) => sendResponse({ success: true, apps }))
          .catch((err: unknown) => {
            sendResponse({ success: false, error: String(err) })
          })
        return true
      }

      case "CHECK_HEALTH": {
        createClientFromStorage()
          .then((client) => client.isHealthy())
          .then((healthy) => sendResponse({ healthy }))
          .catch(() => sendResponse({ healthy: false }))
        return true
      }

      case "GET_SETTINGS": {
        getSettings()
          .then((settings) => sendResponse({ success: true, settings }))
          .catch((err: unknown) => {
            sendResponse({ success: false, error: String(err) })
          })
        return true
      }

      default:
        return false
    }
  }
)

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAMES.BADGE_REFRESH) {
    void updateBadge()
  }
  if (alarm.name === ALARM_NAMES.FOLLOWUP_CHECK) {
    void checkFollowups()
  }
})

// ---------------------------------------------------------------------------
// Install / startup lifecycle
// ---------------------------------------------------------------------------

browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create(ALARM_NAMES.BADGE_REFRESH, {
    periodInMinutes: ALARM_INTERVALS.BADGE_REFRESH_MINUTES,
  })
  browser.alarms.create(ALARM_NAMES.FOLLOWUP_CHECK, {
    periodInMinutes: ALARM_INTERVALS.FOLLOWUP_CHECK_MINUTES,
  })

  void updateBadge()
})

browser.runtime.onStartup.addListener(() => {
  void updateBadge()
})
