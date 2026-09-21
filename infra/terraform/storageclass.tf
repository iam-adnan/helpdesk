# EKS ships no default EBS StorageClass (the in-tree provisioner was removed in
# Kubernetes 1.23+) — without this, sqlite-pvc/media-pvc in k8s/all-in-one.yaml would
# stay Pending forever. Managed here in Terraform (rather than a separate `kubectl
# apply`) so "the whole process is in Terraform" holds for the cluster's storage layer
# too, not just its compute/networking.
resource "kubernetes_storage_class" "gp3" {
  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }
  storage_provisioner = "ebs.csi.aws.com"
  volume_binding_mode = "WaitForFirstConsumer"
  parameters = {
    type = "gp3"
  }

  depends_on = [aws_eks_addon.ebs_csi]
}
