import { useEffect } from 'react';
import { applyDeployUpdateReload, startDeployUpdateWatch } from '../lib/deployUpdateCheck';

/** 偵測到新部署時直接重新載入（不提示） */
export default function DeployUpdateBanner() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    return startDeployUpdateWatch(() => applyDeployUpdateReload());
  }, []);

  return null;
}
