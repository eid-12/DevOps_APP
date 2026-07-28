# CloudBase

CloudBase is a private cloud deployment platform designed to run on a Mini PC using Windows, WSL2, and Docker. This repository currently contains an Angular frontend and a Spring Boot backend scaffold.

## Project Structure

```text
DevOps_APP/
├── README.md
├── docs/
├── frontend/
└── backend/
```

## Current Status

The current focus is the frontend experience. The UI works with local mock data for authentication, admin flows, and project management, while selected infrastructure metrics are fetched from Portainer.

## Run the Frontend

```bash
cd frontend
npm install
npm start
```

Frontend URL: `http://localhost:4200`

## Run the Backend

```bash
cd backend
./mvnw spring-boot:run
```

Note: the backend exists as a scaffold and is not fully integrated with the frontend yet.

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@cloudbase.dev` | `Admin@2026` |
| User | `dev@cloudbase.dev` | `Dev@2026` |

## Implemented Features

- Sign in and sign up flows
- Project request creation with approval flow
- Developer dashboard for viewing and controlling projects
- Admin console for approvals, governance, infrastructure metrics, and audit history
- Responsive dark UI with SVG icon system
- Portainer-backed infrastructure metrics in the frontend

## Next Steps

- PostgreSQL + JWT authentication
- GitHub OAuth integration
- Full backend integration for platform actions
- Nginx Proxy Manager API integration
- WebSockets and terminal streaming
