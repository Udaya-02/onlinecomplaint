
let currentUser = null;
let departments = [];
let authMode = "login";

const $ = id => document.getElementById(id);

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function notify(message, type = "success") {
    $("message").innerHTML = message
        ? `<div class="message ${type}">${escapeHTML(message)}</div>`
        : "";
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

function showOnly(sectionId) {
    ["home", "auth", "dashboard"].forEach(id => {
        $(id).classList.toggle("hidden", id !== sectionId);
    });
    notify("");
}

function home() {
    showOnly("home");
}

function showForm(mode) {
    authMode = mode;
    showOnly("auth");

    $("authTitle").textContent =
        mode === "login" ? "Welcome Back" : "Create Your Account";

    $("authButton").textContent =
        mode === "login" ? "Login" : "Register";

    $("nameField").classList.toggle("hidden", mode !== "register");
    $("name").required = mode === "register";

    $("authSwitch").innerHTML = mode === "login"
        ? 'New to Charani? <button type="button" class="text-btn" onclick="showForm(\'register\')">Create an account</button>'
        : 'Already registered? <button type="button" class="text-btn" onclick="showForm(\'login\')">Login</button>';

    $("authForm").reset();
}

async function loadDepartments() {
    departments = await api("/api/departments");

    $("departments").innerHTML = departments.map(department => `
        <article class="card">
            <h3>${escapeHTML(department.department_name)}</h3>
            <p>${escapeHTML(department.description)}</p>
        </article>
    `).join("");

    $("departmentSelect").innerHTML =
        '<option value="">Select department</option>' +
        departments.map(department => `
            <option value="${department.department_id}">
                ${escapeHTML(department.department_name)}
            </option>
        `).join("");
}

function updateNavigation() {
    if (!currentUser) {
        $("nav").innerHTML = `
            <button class="nav-btn" onclick="home()">Home</button>
            <button class="nav-btn" onclick="showForm('login')">Login</button>
            <button class="btn btn-gold" onclick="showForm('register')">
                Get Started
            </button>
        `;
        return;
    }

    $("nav").innerHTML = `
        <button class="nav-btn" onclick="home()">Home</button>
        <button class="nav-btn" onclick="renderDashboard()">Dashboard</button>
        <button class="btn btn-gold" onclick="logout()">Logout</button>
    `;
}

function startComplaint() {
    if (!currentUser) {
        showForm("login");
        return;
    }

    renderDashboard().then(() => {
        if (currentUser.role !== "admin") {
            $("submitCard").scrollIntoView({ behavior: "smooth" });
        }
    }).catch(error => notify(error.message, "error"));
}

// Login and registration
$("authForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = Object.fromEntries(new FormData(event.target));
    const endpoint = authMode === "login"
        ? "/api/login"
        : "/api/register";

    try {
        const result = await api(endpoint, {
            method: "POST",
            body: JSON.stringify(form)
        });

        currentUser = result.user;
        updateNavigation();
        await renderDashboard();
        notify(result.message);
    } catch (error) {
        notify(error.message, "error");
    }
});

// Submit complaint
$("complaintForm").addEventListener("submit", async event => {
    event.preventDefault();

    const form = Object.fromEntries(new FormData(event.target));

    try {
        const result = await api("/api/complaints", {
            method: "POST",
            body: JSON.stringify(form)
        });

        event.target.reset();
        await renderDashboard();

        notify(
            `${result.message} Reference number: #${result.complaint_id}`
        );
    } catch (error) {
        notify(error.message, "error");
    }
});

// Load and display complaints
async function renderDashboard() {
    if (!currentUser) {
        showForm("login");
        return;
    }

    showOnly("dashboard");
    updateNavigation();

    const isAdmin = currentUser.role === "admin";

    $("welcome").textContent = `Welcome, ${currentUser.name}`;
    $("submitCard").classList.toggle("hidden", isAdmin);
    $("listTitle").textContent = isAdmin
        ? "All Complaints"
        : "My Complaints";

    const complaints = await api("/api/complaints");

    $("total").textContent = complaints.length;
    $("pending").textContent = complaints.filter(
        item => item.status === "Pending"
    ).length;
    $("resolved").textContent = complaints.filter(
        item => item.status === "Resolved"
    ).length;

    if (complaints.length === 0) {
        $("complaintList").innerHTML = `
            <div class="card">
                <h3>No complaints yet</h3>
                <p>Your complaint history will appear here.</p>
            </div>
        `;
        return;
    }

    $("complaintList").innerHTML = complaints.map(item => {
        const badgeClass = item.status === "Resolved"
            ? "badge-resolved"
            : item.status === "In Progress"
                ? "badge-progress"
                : "";

        const date = new Date(item.created_at).toLocaleString();

        return `
            <article class="card complaint-card">
                <div class="complaint-top">
                    <h3>
                        #${item.complaint_id} · ${escapeHTML(item.title)}
                    </h3>
                    <span class="badge ${badgeClass}">
                        ${escapeHTML(item.status)}
                    </span>
                </div>

                <p>
                    <strong>Department:</strong>
                    ${escapeHTML(item.department_name)}
                </p>

                ${isAdmin ? `
                    <p>
                        <strong>Student:</strong>
                        ${escapeHTML(item.student_name)}
                        (${escapeHTML(item.email)})
                    </p>
                ` : ""}

                <p class="complaint-description">
                    ${escapeHTML(item.description)}
                </p>

                <p class="muted">Submitted: ${escapeHTML(date)}</p>

                ${isAdmin ? `
                    <div class="admin-update">
                        <select id="status-${item.complaint_id}"
                                aria-label="Complaint status">
                            ${["Pending", "In Progress", "Resolved"].map(status => `
                                <option value="${status}"
                                    ${item.status === status ? "selected" : ""}>
                                    ${status}
                                </option>
                            `).join("")}
                        </select>

                        <button class="btn btn-primary"
                            onclick="updateStatus(${item.complaint_id})">
                            Update Status
                        </button>
                    </div>
                ` : ""}
            </article>
        `;
    }).join("");
}

// Administrator changes complaint status
async function updateStatus(id) {
    const status = $(`status-${id}`).value;

    try {
        const result = await api(`/api/complaints/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });

        await renderDashboard();
        notify(result.message);
    } catch (error) {
        notify(error.message, "error");
    }
}

// Logout
async function logout() {
    try {
        const result = await api("/api/logout", {
            method: "POST"
        });

        currentUser = null;
        updateNavigation();
        home();
        notify(result.message);
    } catch (error) {
        notify(error.message, "error");
    }
}

// Initial page setup
async function init() {
    try {
        await loadDepartments();

        const result = await api("/api/me");
        currentUser = result.user;

        updateNavigation();

        if (currentUser) {
            await renderDashboard();
        }
    } catch (error) {
        notify(
            "Unable to connect. Check that Node.js and MySQL are running.",
            "error"
        );
        console.error(error);
    }
}

init();
