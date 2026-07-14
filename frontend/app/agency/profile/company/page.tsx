'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react'
import { api, extractErrorMessage, type VerifyStatus } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

type CompanyForm = {
  company_name: string
  short_name: string
  business_license: string
  legal_person: string
  registered_capital: string
  establish_date: string
  business_scope: string
  address: string
  status: string
  bank_name: string
  bank_account_last4: string
  contact_phone: string
  contact_email: string
}

const emptyForm: CompanyForm = {
  company_name: '',
  short_name: '',
  business_license: '',
  legal_person: '',
  registered_capital: '',
  establish_date: '',
  business_scope: '',
  address: '',
  status: '',
  bank_name: '',
  bank_account_last4: '',
  contact_phone: '',
  contact_email: '',
}

export default function AgencyCompanyPage() {
  const router = useRouter()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('unverified')
  const [form, setForm] = useState<CompanyForm>(emptyForm)

  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifyMethod, setVerifyMethod] = useState<'bank' | 'legalPerson'>('legalPerson')
  const [verifyCode, setVerifyCode] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const data = await api.getAgencyCompanyProfile()
        setVerifyStatus(data.verify_status)
        setForm({
          company_name: data.company_name || '',
          short_name: data.short_name || '',
          business_license: data.business_license || '',
          legal_person: data.legal_person || '',
          registered_capital: data.registered_capital || '',
          establish_date: data.establish_date || '',
          business_scope: data.business_scope || '',
          address: data.address || '',
          status: data.status || '',
          bank_name: data.bank_name || '',
          bank_account_last4: data.bank_account_last4 || '',
          contact_phone: data.contact_phone || '',
          contact_email: data.contact_email || '',
        })
      } catch (e) {
        toast.error(extractErrorMessage(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [toast])

  const onChange = (key: keyof CompanyForm, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (form.bank_account_last4 && form.bank_account_last4.length !== 4) {
      toast.error('银行卡后四位需为 4 位数字')
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateAgencyCompanyProfile({
        company_name: form.company_name || undefined,
        short_name: form.short_name || undefined,
        business_license: form.business_license || undefined,
        legal_person: form.legal_person || undefined,
        registered_capital: form.registered_capital || undefined,
        establish_date: form.establish_date || undefined,
        business_scope: form.business_scope || undefined,
        address: form.address || undefined,
        status: form.status || undefined,
        bank_name: form.bank_name || undefined,
        bank_account_last4: form.bank_account_last4 || undefined,
        contact_phone: form.contact_phone || undefined,
        contact_email: form.contact_email || undefined,
      })
      setVerifyStatus(updated.verify_status)
      toast.success('企业信息已保存')
    } catch (e) {
      toast.error(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async () => {
    if (!verifyCode.trim()) {
      toast.error('请输入验证信息')
      return
    }
    setVerifying(true)
    try {
      const res = await api.verifyAgencyCompanyProfile({ method: verifyMethod, code: verifyCode.trim() })
      setVerifyStatus(res.verify_status)
      setVerifyOpen(false)
      setVerifyCode('')
      toast.success(res.message || '认证完成')
    } catch (e) {
      toast.error(extractErrorMessage(e))
    } finally {
      setVerifying(false)
    }
  }

  const VerifyBadge = () => {
    if (verifyStatus === 'verified') {
      return (
        <div className="flex items-center gap-2 text-accent-green">
          <ShieldCheck size={18} />
          <span className="font-medium">已认证</span>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 text-accent-coral">
        <AlertCircle size={18} />
        <span className="font-medium">未认证</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">企业信息</h1>
            <p className="text-sm text-text-secondary mt-0.5">用于认证与对公信息展示</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <VerifyBadge />
          {verifyStatus !== 'verified' && (
            <Button variant="secondary" onClick={() => setVerifyOpen(true)} disabled={loading}>
              去认证
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} disabled={loading || saving} loading={saving}>
            保存
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary">
          <Loader2 className="animate-spin" size={18} />
          <span>加载中...</span>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>企业基本信息</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="企业名称" value={form.company_name} onChange={e => onChange('company_name', e.target.value)} />
              <Input label="企业简称" value={form.short_name} onChange={e => onChange('short_name', e.target.value)} />
              <Input label="统一社会信用代码/营业执照号" value={form.business_license} onChange={e => onChange('business_license', e.target.value)} />
              <Input label="法人" value={form.legal_person} onChange={e => onChange('legal_person', e.target.value)} />
              <Input label="注册资本" value={form.registered_capital} onChange={e => onChange('registered_capital', e.target.value)} />
              <Input label="成立日期" placeholder="YYYY-MM-DD" value={form.establish_date} onChange={e => onChange('establish_date', e.target.value)} />
              <Input label="经营状态" value={form.status} onChange={e => onChange('status', e.target.value)} />
              <Input label="注册地址" value={form.address} onChange={e => onChange('address', e.target.value)} />
              <div className="md:col-span-2">
                <Input label="经营范围" value={form.business_scope} onChange={e => onChange('business_scope', e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>联系方式</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="联系电话" value={form.contact_phone} onChange={e => onChange('contact_phone', e.target.value)} />
              <Input label="联系邮箱" value={form.contact_email} onChange={e => onChange('contact_email', e.target.value)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>对公账户 (可选)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input label="开户行" value={form.bank_name} onChange={e => onChange('bank_name', e.target.value)} />
              <Input label="银行卡后四位" placeholder="1234" value={form.bank_account_last4} onChange={e => onChange('bank_account_last4', e.target.value)} />
            </CardContent>
          </Card>
        </>
      )}

      <Modal
        isOpen={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        title="企业认证"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVerifyOpen(false)} disabled={verifying}>取消</Button>
            <Button variant="primary" onClick={handleVerify} loading={verifying}>提交认证</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm text-text-secondary">认证方式</div>
            <div className="flex gap-2">
              <button
                type="button"
                className={`px-3 py-2 rounded-lg border ${verifyMethod === 'legalPerson' ? 'border-accent-indigo text-accent-indigo' : 'border-border-subtle text-text-secondary'}`}
                onClick={() => setVerifyMethod('legalPerson')}
              >
                法人信息
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-lg border ${verifyMethod === 'bank' ? 'border-accent-indigo text-accent-indigo' : 'border-border-subtle text-text-secondary'}`}
                onClick={() => setVerifyMethod('bank')}
              >
                对公打款
              </button>
            </div>
          </div>

          <Input
            label={verifyMethod === 'bank' ? '验证信息 (如回执/流水号)' : '验证信息 (如身份证后 6 位)'}
            value={verifyCode}
            onChange={e => setVerifyCode(e.target.value)}
            placeholder="请输入验证信息"
          />

          <p className="text-xs text-text-tertiary">
            当前版本为产品内认证状态流转，不对接第三方认证服务。
          </p>
        </div>
      </Modal>
    </div>
  )
}

