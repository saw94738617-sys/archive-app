#!/bin/bash
# 아카이브: GitHub(saw94738617-sys/archive-app)만 새 버전 푸시를 보낼 수 있게 연결 (비밀키 없음)
P=archive-app-515405
N=628094550104
SA=firebase-adminsdk-fbsvc@$P.iam.gserviceaccount.com
REPO=saw94738617-sys/archive-app
gcloud config set project $P
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com fcm.googleapis.com --project=$P
gcloud iam workload-identity-pools describe github --location=global --project=$P >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name=GitHub --project=$P
gcloud iam workload-identity-pools providers describe archive-repo --location=global --workload-identity-pool=github --project=$P >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc archive-repo --location=global --workload-identity-pool=github \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
    --attribute-condition="assertion.repository=='$REPO'" --project=$P
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" \
  --project=$P --format=none
echo
echo "===== ARCHIVE PUSH SETUP: $(gcloud iam workload-identity-pools providers describe archive-repo --location=global --workload-identity-pool=github --project=$P --format='value(state)') ====="
