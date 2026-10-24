import React, { useEffect, useState } from "react";
import {
  Button,
  Col,
  Divider,
  InputNumber,
  Modal,
  Row,
  Slider,
  Space,
  Typography,
} from "../../../ui";
import { LockOutlined } from "../../../ui";
import { formatFileSize } from "../../../shared/formatFileSize";

const { Text } = Typography;

export interface NetworkSettings {
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
}

interface NetworkStatusPanelProps {
  visible: boolean;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  isManuallySet: boolean;
  onClose: () => void;
  onApply: (values: NetworkSettings) => void;
}

/**
 * 网络设置面板（从 NetworkStatusBadge 抽离）：分片大小 / 文件并发 / 分片并发
 * 的可视化调节对话框。本地编辑态自管，确认时通过 onApply 把值交回徽章侧落库。
 */
export const NetworkStatusPanel: React.FC<NetworkStatusPanelProps> = ({
  visible,
  chunkSize,
  fileConcurrency,
  chunkConcurrency,
  isManuallySet,
  onClose,
  onApply,
}) => {
  const [localChunkSize, setLocalChunkSize] = useState(chunkSize);
  const [localFileConcurrency, setLocalFileConcurrency] = useState(
    fileConcurrency
  );
  const [localChunkConcurrency, setLocalChunkConcurrency] = useState(
    chunkConcurrency
  );

  // 每次打开时以当前 store 值为基准重置本地编辑态
  useEffect(() => {
    if (visible) {
      setLocalChunkSize(chunkSize);
      setLocalFileConcurrency(fileConcurrency);
      setLocalChunkConcurrency(chunkConcurrency);
    }
  }, [visible, chunkSize, fileConcurrency, chunkConcurrency]);

  const chunkSizeKB = Math.round(localChunkSize / 1024);

  const emitApply = () =>
    onApply({
      chunkSize: localChunkSize,
      fileConcurrency: localFileConcurrency,
      chunkConcurrency: localChunkConcurrency,
    });

  const handleReset = () => {
    setLocalChunkSize(1024 * 1024);
    setLocalFileConcurrency(3);
    setLocalChunkConcurrency(3);
  };

  return (
    <Modal
      title="网络设置"
      open={visible}
      onCancel={onClose}
      onOk={emitApply}
      width={600}
      footer={[
        <Button key="reset" onClick={handleReset}>
          重置
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="apply" type="primary" onClick={emitApply}>
          应用
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <div>
          <Text strong>分片大小: {formatFileSize(localChunkSize)}</Text>
          <Row gutter={16}>
            <Col span={16}>
              <Slider
                min={128}
                max={5120}
                step={128}
                value={chunkSizeKB}
                onChange={(value) => setLocalChunkSize(value * 1024)}
                marks={{
                  128: "128KB",
                  1024: "1MB",
                  2048: "2MB",
                  5120: "5MB",
                }}
              />
            </Col>
            <Col span={8}>
              <InputNumber
                min={128}
                max={5120}
                value={chunkSizeKB}
                onChange={(value) =>
                  value !== null && setLocalChunkSize(value * 1024)
                }
                addonAfter="KB"
                style={{ width: "100%" }}
              />
            </Col>
          </Row>
        </div>

        <Divider style={{ margin: "12px 0" }} />

        <div>
          <Text strong>文件并发: {localFileConcurrency}</Text>
          <Row gutter={16}>
            <Col span={16}>
              <Slider
                min={1}
                max={10}
                value={localFileConcurrency}
                onChange={setLocalFileConcurrency}
                marks={{
                  1: "1",
                  2: "2",
                  3: "3",
                  4: "4",
                  5: "5",
                  6: "6",
                  7: "7",
                  8: "8",
                  9: "9",
                  10: "10",
                }}
              />
            </Col>
            <Col span={8}>
              <InputNumber
                min={1}
                max={10}
                value={localFileConcurrency}
                onChange={(value) =>
                  value !== null && setLocalFileConcurrency(value)
                }
                style={{ width: "100%" }}
              />
            </Col>
          </Row>
        </div>

        <Divider style={{ margin: "12px 0" }} />

        <div>
          <Text strong>分片并发: {localChunkConcurrency}</Text>
          <Row gutter={16}>
            <Col span={16}>
              <Slider
                min={1}
                max={10}
                value={localChunkConcurrency}
                onChange={setLocalChunkConcurrency}
                marks={{
                  1: "1",
                  2: "2",
                  3: "3",
                  4: "4",
                  5: "5",
                }}
              />
            </Col>
            <Col span={8}>
              <InputNumber
                min={1}
                max={10}
                value={localChunkConcurrency}
                onChange={(value) =>
                  value !== null && setLocalChunkConcurrency(value)
                }
                style={{ width: "100%" }}
              />
            </Col>
          </Row>
        </div>

        {isManuallySet && (
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">
              <LockOutlined style={{ marginRight: 8 }} />
              已启用手动锁定，参数不会自动变化。
            </Text>
          </div>
        )}
      </Space>
    </Modal>
  );
};
