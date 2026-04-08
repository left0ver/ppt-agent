import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp, theme } from 'antd'
import { XProvider } from '@ant-design/x'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2a5f92',
          colorInfo: '#2a5f92',
          borderRadius: 18,
          fontFamily: '"PingFang SC","Microsoft YaHei","Avenir Next",sans-serif',
        },
      }}
    >
      <XProvider>
        <AntApp>
          <App />
        </AntApp>
      </XProvider>
    </ConfigProvider>
  </StrictMode>,
)
