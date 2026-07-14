import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildHtml(taskId: string, initialTenantId: string) {
  const escapedTaskId = escapeHtml(taskId)
  const taskVideoUrl = `/creator/task/${encodeURIComponent(taskId)}/video`
  const uploadAction = initialTenantId
    ? `/api/task-video-upload-form?task_id=${encodeURIComponent(taskId)}&tenant_id=${encodeURIComponent(initialTenantId)}`
    : `/api/task-video-upload-form?task_id=${encodeURIComponent(taskId)}`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex,nofollow" />
    <title>原生视频上传</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --card: #ffffff;
        --text: #111827;
        --muted: #6b7280;
        --border: #dbe2ea;
        --primary: #4f46e5;
        --primary-strong: #4338ca;
        --success-bg: #eefbf3;
        --success-border: #bbf7d0;
        --success-text: #166534;
        --warning-bg: #fff7ed;
        --warning-border: #fed7aa;
        --warning-text: #9a3412;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f8fafc 0%, var(--bg) 100%);
        color: var(--text);
      }
      .wrap {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px 16px 40px;
      }
      .back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        text-decoration: none;
        font-size: 14px;
        margin-bottom: 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid rgba(219, 226, 234, 0.9);
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.08);
      }
      h1 {
        font-size: 28px;
        line-height: 1.2;
        margin: 0 0 8px;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .panel {
        margin-top: 20px;
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px;
        background: #fff;
      }
      .label {
        display: block;
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 12px;
      }
      input[type="file"] {
        display: block;
        width: 100%;
        font-size: 14px;
      }
      .hint {
        margin-top: 10px;
        font-size: 12px;
      }
      .notice {
        margin-top: 16px;
        border-radius: 16px;
        padding: 14px 16px;
        font-size: 13px;
        line-height: 1.6;
      }
      .notice.success {
        background: var(--success-bg);
        border: 1px solid var(--success-border);
        color: var(--success-text);
      }
      .notice.warn {
        background: var(--warning-bg);
        border: 1px solid var(--warning-border);
        color: var(--warning-text);
      }
      .status {
        margin-top: 14px;
        min-height: 20px;
        font-size: 13px;
        color: var(--muted);
      }
      .status.strong {
        color: var(--text);
        font-weight: 600;
      }
      .status.error {
        color: #b42318;
      }
      .status.success {
        color: var(--success-text);
      }
      .progress {
        margin-top: 14px;
        height: 10px;
        border-radius: 999px;
        background: #eef2ff;
        overflow: hidden;
        border: 1px solid #dbe4ff;
      }
      .progress-bar {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, var(--primary) 0%, #7c72ff 100%);
        transition: width 0.2s ease;
      }
      .meta {
        margin-top: 10px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: var(--muted);
      }
      .submit {
        margin-top: 18px;
        display: inline-flex;
        width: 100%;
        justify-content: center;
        align-items: center;
        gap: 8px;
        min-height: 52px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(180deg, var(--primary) 0%, var(--primary-strong) 100%);
        color: #fff;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
      }
      .submit:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <a class="back" href="${taskVideoUrl}">返回视频任务</a>
      <div class="card">
        <h1>原生视频上传</h1>
        <p>这个页面不加载创作者工作台布局，只保留最基础的浏览器表单提交，专门用于 Safari 上传视频。</p>

        <form id="upload-form" method="post" enctype="multipart/form-data" action="${uploadAction}">
          <input type="hidden" name="task_id" value="${escapedTaskId}" />
          <input type="hidden" name="file_type" value="video" />

          <div class="panel">
            <label class="label" for="file-input">选择视频文件</label>
            <input id="file-input" name="file" type="file" required accept="video/*,.mp4,.mov,.avi,.mkv" />
            <p class="hint">支持 MP4、MOV、AVI、MKV。文件较大时，点提交后页面停一会儿是正常的，不要重复点。</p>
          </div>

          <div class="notice success">选完文件后点一次“提交视频”即可。如果网络慢，提交后可能停留 1 到 5 分钟。</div>
          <div class="notice warn">提交期间不要刷新、不要返回、不要再次点提交。</div>
          <div class="progress" aria-hidden="true">
            <div id="progress-bar" class="progress-bar"></div>
          </div>
          <div class="meta">
            <span id="progress-text">等待开始</span>
            <span id="stage-text">待上传</span>
          </div>
          <div id="status" class="status"></div>

          <button
            id="submit-button"
            class="submit"
            type="submit"
          >提交视频</button>
        </form>
      </div>
    </div>
    <script>
      (function () {
        var form = document.getElementById('upload-form');
        var fileInput = document.getElementById('file-input');
        var submitButton = document.getElementById('submit-button');
        var status = document.getElementById('status');
        var progressBar = document.getElementById('progress-bar');
        var progressText = document.getElementById('progress-text');
        var stageText = document.getElementById('stage-text');
        var taskId = ${JSON.stringify(taskId)};
        var initialTenantId = ${JSON.stringify(initialTenantId)};
        var isSubmitting = false;

        function setStatus(message, type) {
          status.textContent = message || '';
          status.className = type ? 'status ' + type : 'status';
        }

        function setProgress(percent) {
          var safePercent = Math.max(0, Math.min(100, percent || 0));
          progressBar.style.width = safePercent + '%';
          progressText.textContent = safePercent + '%';
        }

        function setStage(message) {
          stageText.textContent = message || '';
        }

        function buildTaskResultUrl(statusValue, message) {
          return '/creator/task/' + encodeURIComponent(taskId) +
            '?upload_status=' + encodeURIComponent(statusValue) +
            '&upload_kind=video&upload_message=' + encodeURIComponent(message) +
            '&upload_ts=' + Date.now();
        }

        function resolveTenantId() {
          if (initialTenantId) return initialTenantId;

          try {
            var currentUrl = new URL(window.location.href);
            var tenantFromQuery = (currentUrl.searchParams.get('tenant_id') || '').trim();
            if (tenantFromQuery) return tenantFromQuery;
          } catch (error) {}

          try {
            var tenantFromStorage = (window.localStorage.getItem('contentguard_tenant_id') || '').trim();
            if (tenantFromStorage) return tenantFromStorage;
          } catch (error) {}

          return '';
        }

        function buildSubmitUrl(tenantId) {
          var actionUrl = new URL(form.action, window.location.origin);
          actionUrl.searchParams.set('task_id', taskId);
          actionUrl.searchParams.set('response', 'json');
          if (tenantId) {
            actionUrl.searchParams.set('tenant_id', tenantId);
          } else {
            actionUrl.searchParams.delete('tenant_id');
          }
          return actionUrl;
        }

        form.addEventListener('submit', async function (event) {
          if (isSubmitting) {
            event.preventDefault();
            return;
          }

          var file = fileInput.files && fileInput.files[0];
          if (!file) {
            event.preventDefault();
            setStatus('请先选择要上传的视频文件', 'error');
            return;
          }

          var tenantId = resolveTenantId();
          if (!window.XMLHttpRequest || !window.FormData) {
            try {
              var fallbackAction = new URL(form.action, window.location.origin);
              fallbackAction.searchParams.set('task_id', taskId);
              if (tenantId) {
                fallbackAction.searchParams.set('tenant_id', tenantId);
              }
              form.action = fallbackAction.toString();
            } catch (error) {
              // ignore malformed action URL and use the existing form action
            }
            return;
          }

          event.preventDefault();
          isSubmitting = true;
          submitButton.disabled = true;
          submitButton.textContent = '上传中...';
          setProgress(0);
          setStage('正在上传到服务器');
          setStatus('正在上传视频，请不要关闭页面', 'strong');

          var formData = new FormData();
          formData.append('task_id', taskId);
          formData.append('file_type', 'video');
          formData.append('file', file, file.name);
          if (tenantId) {
            formData.append('tenant_id', tenantId);
          }

          var xhr = new XMLHttpRequest();
          xhr.open('POST', buildSubmitUrl(tenantId).toString(), true);
          xhr.responseType = 'json';
          xhr.timeout = 10 * 60 * 1000;
          xhr.setRequestHeader('Accept', 'application/json');

          xhr.upload.addEventListener('progress', function (event) {
            if (!event.lengthComputable) {
              setStage('正在上传到服务器');
              setStatus('文件正在发送，请不要关闭页面', 'strong');
              return;
            }

            var percent = Math.round((event.loaded / event.total) * 100);
            setProgress(percent);
            if (percent < 100) {
              setStage('正在上传到服务器');
              setStatus('已上传 ' + percent + '%，请继续等待', 'strong');
            } else {
              setStage('正在等待对象存储确认');
              setStatus('文件已发送，正在等待服务器完成对象存储上传', 'strong');
            }
          });

          xhr.addEventListener('load', function () {
            var response = xhr.response;
            if (!response && xhr.responseText) {
              try {
                response = JSON.parse(xhr.responseText);
              } catch (error) {
                response = null;
              }
            }

            if (xhr.status >= 200 && xhr.status < 300 && response && response.status === 'success') {
              setProgress(100);
              setStage('任务已提交');
              setStatus(response.message || '视频已上传，正在返回任务页', 'success');
              submitButton.textContent = '上传完成';

              var redirectUrl = response.redirect_url || buildTaskResultUrl('success', response.message || '视频已上传');
              window.setTimeout(function () {
                window.location.href = redirectUrl;
              }, 600);
              return;
            }

            isSubmitting = false;
            submitButton.disabled = false;
            submitButton.textContent = '重新提交视频';
            setStage('上传失败');
            setStatus(
              (response && response.message) || '上传失败，请检查网络后重试',
              'error'
            );
          });

          xhr.addEventListener('error', function () {
            isSubmitting = false;
            submitButton.disabled = false;
            submitButton.textContent = '重新提交视频';
            setStage('网络错误');
            setStatus('上传请求失败，请检查网络后重试', 'error');
          });

          xhr.addEventListener('timeout', function () {
            isSubmitting = false;
            submitButton.disabled = false;
            submitButton.textContent = '重新提交视频';
            setStage('上传超时');
            setStatus('上传等待超时，请返回任务页确认是否已提交成功，再决定是否重试', 'error');
          });

          xhr.addEventListener('loadstart', function () {
            setStage('开始上传');
          });

          xhr.send(formData);
        });
      })();
    </script>
  </body>
</html>`
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params
  const taskId = decodeURIComponent(params.id || '').trim()
  const initialTenantId = request.nextUrl.searchParams.get('tenant_id')?.trim() || ''
  if (!taskId) {
    return new NextResponse('缺少任务 ID', { status: 400 })
  }

  return new NextResponse(buildHtml(taskId, initialTenantId), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export const runtime = 'nodejs'
