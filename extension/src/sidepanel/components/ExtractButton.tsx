import type { ExtractionStatus, Platform } from '@shared/types'
import styles from './ExtractButton.module.css'

interface Props {
  status: ExtractionStatus
  platform: Platform
  onClick: () => void
}

const LABEL: Record<ExtractionStatus, string> = {
  idle: 'Extract',
  detecting: 'Detecting…',
  capturing: 'Extract Now',
  extracting: 'Extracting…',
  complete: 'Extract Again',
  error: 'Retry',
}

export function ExtractButton({ status, platform, onClick }: Props) {
  const disabled = status === 'detecting' || status === 'extracting' || platform === 'unknown'

  return (
    <button
      className={`${styles.btn} ${styles[status]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {status === 'capturing' && <span className={styles.dot} />}
      {status === 'extracting' && <span className={styles.spinner} />}
      {LABEL[status]}
    </button>
  )
}
