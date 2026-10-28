import { Button, Modal } from 'react-bootstrap';
import type { ReactNode } from 'react';

export function ConfirmModal(props: {
  show: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal show={props.show} onHide={props.onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>{props.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{props.children}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button variant={props.variant ?? 'danger'} onClick={props.onConfirm} disabled={props.busy}>
          {props.confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
