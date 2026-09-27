# Secure Design Principles

## What Are Security Design Principles?

When you write non-trivial software, you have to break the problem into smaller components that work together. This process of deciding how to break a problem into components and how they will work together is called design or architectural design. For example, you are designing when you are trying to decide how to break a problem into a particular set of classes and methods. The result of those decisions is also called a design or architectural design. The word "design" is also used to describe user interface design, but that is not the sense we mean here.

Remember that the design process, like any other software development process, doesn’t happen just once. It is really common to try to implement some software, realize that the design doesn’t work, and then change the design. You often have to change a design when you change what the software does. So the design process happens whenever you think about changing how to break the problem down in your software.

Some designs are better than others: some are easier to maintain, faster, and so on. In particular, some designs are more secure than other designs. There is no magic trick that guarantees that your design is secure. But people have been developing software for decades, and through experience, they have identified a set of design principles that can help you choose good designs over bad ones.

Design principles are broadly accurate guides based on experience and practice. Put another way, design principles are rules of thumb for helping you quickly avoid a bad design and guiding you to a good design instead. Secure design principles do not guarantee security, though; they are an aid to thinking, not a replacement for thinking. For example, sometimes a principle will not apply at all. Sometimes principles clash; for example, one secure design principle is keeping things simple, but sometimes you need more complexity to get something else done. In rarer cases, there may be good reasons from a security point of view to even completely violate a principle. That said, your software will generally be more secure if you think about secure design principles and try to apply them. Secure design principles are distilled wisdom, and you would be wise to consider them.

When thinking about your design, you need to think about what components you can trust (and how much), and what components you cannot necessarily trust. Some design principles talk about a trust boundary. The trust boundary is simply the boundary between the components you trust and the components you do not necessarily trust. Where the trust boundary is depends on what software you are developing:

- If you are writing a server-side application, you presumably trust what you are running on (e.g., the computer, operating system, and container runtime if there), but not the external client systems (some of which might be controlled by an attacker). The trust boundary is between the server and the clients.

- If you are writing a mobile (smartphone) application that talks to a server you control, you presumably trust that remote server. You should not trust the communication path between your mobile application and server (so you will want to use TLS to encrypt it). You certainly should not trust other applications on the smartphone, unless you have special reason to trust one. So clearly, there is a boundary between your mobile application and (1) the general Internet and (2) other mobile applications. Trust is often not absolute; you probably trust that the mobile smartphone operating system will run for that user, but that user might be an attacker, so you should probably ensure that some secrets never get into the mobile application at all.

## Widely-Recommended Secure Design Principles

Software has been under attack for decades, and many key secure design principles were identified in 1975 by Jerome H. Saltzer and Michael D. Schroeder (S&S) in their paper, The Protection of Information in Computer Systems. What is great about their list is that it has stood the test of time; these principles are just as important today. Other principles have been identified since then, but let’s start with their list.

In their list, they focus on the protection system - that is, the part of the system that the security depends on. Here is their list, along with some alternative names:

- Least privilege: Each (human) user and program should operate using the fewest privileges possible. This principle limits the damage from an accident, error, or attack. It also reduces the number of potential interactions among privileged programs, so unintentional, unwanted, or improper uses of privilege are less likely to occur.

- Complete mediation (aka non-bypassability): Every access attempt must be checked; position the mechanism so it cannot be subverted. A synonym for this goal is non-bypassability.

- Economy of mechanism (aka simplicity): The system, in particular the part that security depends on, should be as simple and small as possible.

- Open design: The protection mechanism must not depend on attacker ignorance. Instead, you should act as if the mechanism is publicly known, and instead depend on the secrecy of relatively few and easily changeable items like passwords or private keys. An attacker should not be able to break into a system just because the attacker knows how it works. "Security through obscurity" generally does not work.

- Fail-safe defaults: The default installation should be the secure installation. If it is not certain that something should be allowed, don’t allow it.

- Separation of privilege (e.g., use two-factor authentication): Access to objects should depend on more than one condition (such as having a password). That way, if an attacker manages to break one condition (e.g., by stealing a key), the system remains secure. Note: sometimes programs are broken into parts, each part with a different privilege. This approach is sometimes confusingly called "privilege separation" - but breaking a program into parts with different privileges is something else. In this terminology, that is an example of least privilege.

- Least common mechanism (aka minimize sharing): Minimize the amount and use of shared mechanisms. Avoid sharing files, directories, operating system kernel execution, or computers with something you do not trust, because attackers might exploit them.

- Psychological acceptability (aka easy to use): The human interface must be designed for ease of use, so users will routinely and automatically use the protection mechanisms correctly.

Since then, other secure design principles have also been identified by different people; we will cover a few of those throughout the courses in this program.

Remember, design principles are simply rules of thumb. As you break your problem down to solve it, you should think about these principles, because they will help guide you to creating more secure software. There are some cases where you will have good reasons to not apply them. These principles do not replace thinking - they help guide you when you are thinking.

Next, we will look in more detail at a few of these principles, because they have ramifications that might not be obvious. We will start by looking at least privilege.

## Least Privilege

We already noted that least privilege is an important secure design principle. The basic idea is that each user (human or program) should operate using the fewest privileges possible. In general, don’t allow reading or writing of information unless you need to do that for that user.

Least privilege limits the potential damage from an attack, and also reduces the complexity of security-related interactions. This even extends to the internals of a program: only the smallest portion of a program which needs privileges should (ideally) have them. Of course, at some point, this becomes too complicated to do (and we also want to keep the program as simple as reasonably possible).

### Ways to Implement Least Privilege

Here are several ways to implement least privilege, depending on the circumstance:

- Don’t give a program any special privileges (where practical)If this can be done, do it, as this is the best from a security point of view. For example, Linux supports making programs setuid or setgid, so that simply running the program gives the program the privileges of its owner. If you can completely avoid using this mechanism, consider doing it, because it gives special privileges to programs. There are often safer alternatives; for example, requiring people to log in specifically with privileges (this is the purpose of sudo).

- Minimize the special privileges a program gets, including minimizing whatever data is accessible to itOn Linux, you might have a program below (or run on the behalf of) a special group or user that only has specific rights, instead of something more privileged (like root). If you are calling a database system query interface, limit the rights of the database user that the application uses. If your database system uses SQL, you might be able to use the SQL GRANT command to limit the privileges the program gets. Redis users might use Redis’ ACL command to limit privileges.

- Permanently give up privileges as soon as possibleFor example, if you are using Linux saved group IDs, user IDs, or capabilities, permanently drop those extra privileges as soon as possible. That way, if the attack happens afterwards, the attacker cannot exploit those privileges.

- If you cannot permanently give up privileges, try to minimize the time the privilege is activeThis is less effective, because some attacks can force programs to run arbitrary code. But some attacks can only make programs do a limited number of things, and minimizing when the privilege is active will reduce what an attacker can do.

- Break the program into different modules, and give special privileges to only one or a few modules (portions of the program)The privileged module will ideally not even fully trust the other parts of your program (aka a mutually suspicious design). If you do that, then if some part of your program is subverted, it will limit what an attacker can immediately do. For example, you might split the part of a program that implements a GUI from a different part with privileges. Separation mechanisms like containers, virtual machines, Linux seccomp, and various kinds of security wrappers can help you separate parts of your program so that subversion of one part does not necessarily break another. Beware: make sure that you configure these mechanisms to securely separate the modules, and limit the privileges in each part. These separation mechanisms are often not foolproof, so don’t assume that using them automatically makes your program secure. That said, they can make your program harder to attack and may reduce damage if an attack is successful.

- Minimize (limit) the attack surfaceThe attack surface is the set of operations (e.g., its API and its open network ports) that a potential attacker can access. For example, if you allow public access to some method, then you are giving all attackers access to that method - are you sure you need to? Where possible, limit the operations that a potential attacker can access. If the public does not need access, do not give the public access. In particular, avoid leaving debug operations in production systems that an attacker can access; debug operations are a common source of problems.

- Validate (check) input before you accept itDon’t just accept data from a potential attacker; check it thoroughly before accepting it. We will discuss input validation in more detail later. Of course, you need to make sure that attackers cannot bypass this input validation; this is such a big issue that it has its own principle, complete mediation, aka non-bypassability. We will be talking about that next.

- Sandbox your programIntentionally run your program (or part of it) in an environment with intentionally-restricted capabilities.

- Minimize privileges for files & other resourcesFor example, normally, you should not have files writable by everyone (even readable by everyone is often dubious). On Android, a file writable by all could be changed by a different (possibly malicious) application.

Incorrect permissions are such a common cause of security vulnerabilities that it is 2021 CWE Top 25 #22 and 2019 CWE Top 25 #15. It is CWE-732 (Incorrect Permission Assignment for Critical Resource). Incorrect permissions are especially bad if the default permissions are insecure; that special case is CWE-276 (Incorrect Default Permissions).

### Examples of Least Privilege

Let's take a look at a few specific examples.

When developing web-based applications, do not allow users to access (read) files such as the server’s include and configuration files. This data may accidentally provide enough information (e.g., passwords) to break into the system. If you are using a traditional web server, keep everything you don’t need to serve directly to users outside the "documentation root" (DOCROOT); that way, attackers cannot even easily request the information. Deny serving files that you know should not be directly served (such as include files).

Don’t allow users to write system configuration files by default (e.g., system files in /etc on Linux and Unix), and, whenever practical, consider preventing reads by normal users as well. The problem is that system administrators often put passwords and keys in configuration files. If there are reasons to give broader read permissions to some of the system configuration information (e.g., in /etc), consider creating a system configuration directory instead of a system configuration file where the directory name conventionally ends in .d. System configuration directories are often better anyway, because they make it trivial for package managers to add and remove specific configuration files. For security, system configuration directories not only reduce the risk of error, but specific files (such as those with secret keys and passwords) can have more restricted permissions. If you use a system configuration directory, it is less of a problem to allow user read, because it is much easier to protect the secret keys and passwords.

If you implement an external API (e.g., with REST or GraphQL), don’t provide a write operation unless you expect it to be used. If you allow writes, try to maximally limit who can write. For example, have owners of specific data and only let owners modify that data, instead of allowing anyone to modify anything. If practical, design your software so it cannot write data even if it is subverted by an attacker (though this often is not practical).

It is unfortunately common to mismanage privileges. For example, there are many cases where programs have failed to drop privileges in all cases (e.g., because raising an exception skipped the code that dropped privileges, or because the code that was supposed to drop privileges does not work in all cases).

Improper privilege management is such a common cause of security vulnerabilities that it is 2021 CWE Top 25 #29 and 2019 CWE Top 25 #24. It is CWE-269 (Improper Privilege Management).

## Complete Mediation (Non-Bypassability)

Every time a program gets a request, at least from a source the program cannot completely trust (it is outside the trust boundary), the program must check the request. Examples of security checks are checking that the request is authorized and that the input is valid before you act on that data. This principle is also called non-bypassability, because the point is that it must not be possible for an attacker to bypass security checks.

A common mistake is to try to run security checks on a system that the attacker can control. If an attacker can control a system, then the attacker can easily bypass all security checks run by that system. Let’s look at some examples of insecure designs.

### Insecure Design: Client-Side HTML Input Validation

A simple example of an insecure design is when a server-side web application sends some HTML to a client, and the HTML includes some validation requirement. For example, the HTML might include the following statement to require that the maximum length be no more than 100:

<input id="name" type="text" maxlength="100">

This HTML is fine if its purpose is to be a quick check to counter accidental mistakes. But since attackers can control their own web browser, this maximum length check is trivial to bypass. An attacker can easily send a much longer input. You cannot depend on the web browser to do any security-relevant checking for you if the attacker could control or replace the web browser.

### Insecure Design: Client-Side JavaScript/WASM Input Validation

A related and common insecure design is where code is sent to web browsers, for example, as JavaScript or WebAssembly (WASM), and that code does security checks before sending its data to a server. In most situations, an attacker can control the web browser while the server is under your control, so again, you cannot trust anything the web browser does. Put another way, any security checks in the code sent to the browser can be trivially bypassed by an attacker, since attackers control their own web browsers. A related problem is providing direct database access to untrusted users. Often users do not need full access, so this is giving users far more privilege than they need (violating least privilege), and such access can make it harder to prevent bypassing security checks. The following figure shows this mistake:

An Insecure JavaScript Application

### Secure Design: Input Validation on an Environment You Can Trust

You can use JavaScript securely, you just need to do it correctly. You can send JavaScript to the client, and you can do some security-relevant checks in the browser (say, to give quick feedback). But if attackers could control some web browsers (but not the servers), the browser-side security checks are irrelevant for security. In this common case, you have to do all security-related input checks in the servers, even if some of the checks were supposed to be done on the client and are now being "redone". The input checks (validations) are not really being redone, because the client-side ones could not be trusted.

The following figure shows a similar, but secure design; notice that all the security-related checks are being done in the server, since in this case, that is the system we can trust. It also prevents direct database access, which is often a good idea if users do not need direct access:

A More Secure Alternative of the JavaScript Application

### Insecure Design: Mobile Application with Client-Side Checking

A similar common insecure design is code in smartphone mobile applications that does all the security checks before sending its data to a server. Again, we cannot assume that any security checks in the mobile application will actually be made. An attacker could modify the mobile application, or write a different application, to bypass any checks made in the mobile application. If you are writing a smartphone mobile application, you also normally cannot trust the other applications - the other applications may themselves be malicious!

### Insecure Design: Client Application Depending on an Untrusted Server

Don’t be confused; the message is not "server good, client bad". The issue is that in almost all cases, any code you need to trust must run in an environment you can trust.

If you are writing a web browser, for example, you will need to trust the local operating system services, but you certainly cannot trust arbitrary remote web servers - some of those remote web servers may send you malicious data!

### The Key: Run Code You Must Trust in an Environment You Can Trust

In short: any code you need to trust must (in most cases) run in an environment you can trust, not on a system potentially controlled by an attacker.

You can use client-side JavaScript, client-side WebAssembly, and mobile applications - that is not the problem. You can write web browsers, too! The problem is trusting a system that might be under the control of an attacker. If you have a web-based client-server system, for example, generally, the code that runs on the server (that you control) must do all the security checking. After all, attackers can build or modify their own web clients, including any JavaScript sent to their client by a server. It is fine to run checks on a system you don’t fully trust if you want to provide rapid response for unintentional mistakes. But that is not enough - for security, all security checks have to be done (or redone) on a system that you can fully trust. You can run those server-side checks using JavaScript, WebAssembly, or anything else that you trust - but you have to run the checks on a system you can trust.

Some developers try to run code on systems they cannot trust by using obfuscation. That is, they will use tools that try to make it harder to understand the code sent to a system they cannot trust. An example of this is using JavaScript minification and hoping that it will make the client code hard to figure out. Don’t do that! JavaScript minification’s purpose is to reduce the number of bytes sent over a network, not to hide what the code does or to prevent changing it.

What can be obfuscated can be de-obfuscated, and it is remarkably easy for attackers to de-obfuscate information. Many tools exist that can quickly de-obfuscate information. Trying to run code you need to trust on systems you cannot trust is best avoided.

It is much better to run software you need to trust on a system you can trust; then the software just works all the time.

### Warning Signs

Building a system with security checks that can be bypassed is a dangerous mistake. Not only does it mean the system is insecure, but it is often very difficult to fix this mistake once you make it. You might have to rewrite a lot of software to fix this mistake. Here is a quick checklist of things to look for that might indicate these kinds of mistakes:

- HTML or other data format sent to a client that performs security-relevant input validation on a system an attacker might control. This could be fine, but only if all of those checks are re-performed in a trusted environment.

- JavaScript or other code sent to the client that does input validation or other security-relevant operations on a system an attacker might control. This could be fine, but only if all of those checks are re-performed in a trusted environment.

- A mobile app that does security-relevant input validation. This is the same client-side issue.

- A database that is directly accessible via the network for use by a client application (web browser, mobile app, etc.). This can be secure, but you must ensure that all operations the user is allowed to perform are authorized. In many systems, you can control this with the SQL GRANT command, if you need to do this. However, it is often better (or necessary) to mediate access using a program instead of providing direct access to a database. Direct database access can make it harder to do input validation. It often violates least privilege, since often the user does not need full access to the database. If you do provide direct access to a database, consider limiting the privileges. For example, you might grant access to only a read-only view of just part of the database.

- A network communication channel that an attacker can hijack. Properly-implemented network connections that use TLS (such as https:) and SSH resist hijacking; almost everything else does not. Software may communicate over the channel assuming that it is talking to the same user/software, but this is easily bypassed if the channel can be hijacked.

### Trying to Run Software You Must Trust in Untrustworthy Environments

Could you try to run software that you need to trust on a system you don’t trust? You can try, but that generally works out badly, and trying to do it is a highly advanced topic. Here are some of the techniques that have been tried:

- One technique is homomorphic encryption. This lets you run code while data stays encrypted. But currently homomorphic encryption is only practical for specialized circumstances. It is orders of magnitude slower and far more complex.

- Intel’s Software Guard eXtensions (SGX) CPU mechanisms are supposed to enable execution and data storage, but, in practice, they have been repeatedly broken (Plundering of crypto keys from ultrasecure SGX sends Intel scrambling again, by Dan Goodin).

- If you are trying to secure games on a laptop/desktop, and you don’t trust the laptop/desktop, there are anti-cheat systems. But anti-cheat systems are routinely broken. You are better off having physical events where all the laptops/desktops are owned by you.

In general, you are better off with simple solutions that do not involve trying to trust systems controlled by attackers.

## The Rest of the Saltzer & Schroeder Design Principles

Let’s briefly look at the rest of the secure design principles identified by Saltzer and Schroeder (beyond least privilege and complete mediation):

- Economy of mechanism (aka simplicity)The system, in particular the part that security depends on, should be as simple and small as possible. This makes that part of the system easier to review and harder to get wrong. Of course, modern software is often asked to provide lots of functionality, so you typically cannot make everything extremely simple, but you can at least work to make the part that security depends on as simple as possible.

- Open designThe protection mechanism must not depend on attacker ignorance. Instead, the mechanism should be public, depending on the secrecy of relatively few (and easily changeable) items, like passwords or private keys. An open design makes extensive public scrutiny possible. An open design also makes it possible for users to convince themselves that the system about to be used is adequate. Frankly, it is not realistic to try to maintain secrecy for a system that is widely distributed; decompilers and subverted hardware can quickly expose any "secrets" in an implementation. One of the big advantages of open source software (OSS) is that it better implements the open design principle; OSS source code has an open design, enabling anyone else to review it and make changes to potentially improve it. Of course, the OSS has to actually be reviewed for this to help, but it is an important potential advantage.

- Fail-safe defaults (aka fail-secure defaults)The default installation should be the secure installation. If it is not certain that something should be allowed, don’t allow it. For example, don’t distribute software with an empty or default password; instead, require that a new password be set when the software is installed. That way, if someone just quickly installs it, it will not have a vulnerability due to a known password. Make sure the default permissions are secure; weakness category CWE-276 is Incorrect Default Permissions.

- Separation of privilege (e.g., use two-factor authentication)Access to objects should depend on more than one condition, so that breaking one condition does not break everything. In short, make sure that if your software has a login mechanism, it has a way to support two-factor authentication (2FA).

- Least common mechanism (aka minimize sharing)Minimize the amount and use of shared mechanisms if the sharers have different privileges. Avoid sharing files, directories, operating system kernel execution, or computers with something you don’t trust, because attackers might exploit them. Of course, in many cases, this is traded off because of other factors. An obvious example is cloud services: in some cases, using a cloud service may cause your program to run in a shared environment with an adversary. In the case of cloud services, there are often mitigating factors that make it acceptable (e.g., the cloud service provider may provide a host of measures to provide better isolation, and/or may have a more experienced team protecting and monitoring the systems than you could). That said, it is still true that anything you share with an attacker might add another way for it to get attacked. If such sharing is too risky for your application, then you could choose alternatives with less sharing (such as a single-tenant cloud or a private cloud). In some cases, sharing can reduce costs, but increase security risks. The best decision depends on the circumstances, and all the design principles can do is help you identify the trade-off.

- Psychological acceptability (aka easy to use)The human interface must be designed for ease of use so users will routinely and automatically use the protection mechanisms correctly. Mistakes will be reduced if the security mechanisms closely match the user’s mental image of his or her protection goals. Some people think that there is always a trade between security and ease-of-use, but that is often not true; if something is hard to use, it is often insecure in practice (because people will work around it). Bad ease-of-use for security reasons usually shows that the software was not designed to be secure in the first place; hopefully, the courses in this professional certificate program will help you avoid that!

## Other Design Principles: Beware of Race Conditions

Many other design principles have been proposed, based on problems that have happened to past systems. Next, we will take a look at a few other design principles that you should consider.

A race condition happens when a system’s correct behavior depends on the sequence of events, but there is no control over that sequence. Race conditions generally involve one or more processes or threads accessing a shared resource, but this multiple access has not been properly controlled.

If there is no control at all, that is a defect, and it might even be a vulnerability. Many programs, to be secure, have to do two things: (1) determine if a request is authorized, and (2) if it is, act on that request. If it is possible for an attacker to change the situation between steps 1 and 2, then the program could correctly determine that it is authorized, but then allow a different action that was not authorized. This kind of security mistake is so common that it has a name, a time of check - time of use (TOCTOU) race condition.

In many situations, the right way to counter TOCTOU race conditions is to implement and use APIs that both check the authorization and perform the action simultaneously (that is, they will not allow an attacker to change the situation between the check and the use). For example:

- When you create files or anything else that has privileges associated with it, do not create them and then try to reduce their privileges. Instead, create them with very minimal privileges and expand them as needed. That way, there is no window of time where an attacker might be able to exploit the excess permissions.

- If you are writing a program for a Unix-like system, do not call access() to see if a file can be opened, followed by a call to open() to actually open the file. Instead, set things up to just call open() directly, since open() includes a check to see if the access is permitted.

- If you want to ensure that you create a new file on a Unix-like system, make sure you request that it be created exclusively (O_EXCL in the C open() API, and the letter x in fopen() and the option flags used in many other programming languages). Again, that way, there is no window of opportunity for an attacker to create the file before the program can (if the attacker could do so).

A somewhat common error on Unix-like systems is insecurely creating temporary files. Temporarily files may be created in a directory where an attacker can influence the creation and names of other files. If an attacker creates a file first, and the application then requests to "create" a file without requesting that it be exclusive, then the existing file controlled by the attacker will be reused. Simply using the exclusive option isn’t enough, since that would still permit a denial of service. The solution is to use a simple loop that creates a "random" filename in the intended directory and then attempt to create exclusively with maximally limited privileges.

Most languages have a routine or command to securely create temporary files; use them where available. In Python the tempfile module can securely create temporary files. Shell scripts can use the mktemp command to securely create temporary files.

Race conditions are such a common cause of security vulnerabilities that it is 2021 CWE Top 25 #33 and 2019 CWE Top 25 #29. Concurrent Execution using Shared Resource with Improper Synchronization ('Race Condition') is CWE-362. Insecure Temporary File is CWE-377.

## Other Design Principles: Harden the System

Defects happen! But they don’t need to turn into vulnerabilities. Instead, try to design your system so a single defect is much less likely to result in complete compromise. This is basically a specific application of the least privilege principle, but, if you think specifically about making the system hard to subvert even when there is a defect in it, you may identify other steps you can take.

There are many mechanisms that can harden a system. Examples include Content Security Policy (CSP) and Address Space Layout Randomization (ASLR). We’ll discuss some hardening mechanisms later in the course. The point here is that you should either enable hardening mechanisms or ensure that your users can enable them.

## Other Design Principles: Keep Secrets Secret

If your software manages secrets like private cryptographic keys and passwords, make sure they stay secret. In particular:

- Do not put live secrets in your source code. Source code is managed by version control systems and often gets spread to more people and systems than you might think.

- Store passwords used for inbound authentication with an algorithm specifically designed to do this. We will discuss these later throughout the courses in this professional certificate program, but these kinds of algorithms are called iterated per-user salted hash algorithms (such as argon2id, bcrypt, or PBKDF2). If done correctly, it is infeasible for an attacker to determine many passwords, even if the attacker gets the encrypted password data.

- Use https:// instead of http:// ; that provides an encrypted link to prevent data leakage.

- Avoid accepting and sending data (like private keys) as command line parameters, where you can; command line parameters are often visible to other processes on a system.

## Other Design Principles: Trust Only Trustworthy Channels

In general, only trust information (input or results) from trustworthy channels. For example, use https:// instead of http:// when contacting a server, because that enables checking if the server has a valid cryptographic certificate for that site. In general, you should use https because that will prevent attackers from snooping or modifying information exchanged with other users.

## Other Design Principles: Separate Data from Control

A useful trick for developing more secure software is to separate data from control (aka programs). Put another way, you should separate the passive data from the programs that are executed. That way, if an attacker manages to slip in "extra" information into data, that will not cause a potentially-malicious program to be executed. This is basically another way to implement least privilege - don’t give data the right to run as a program.

A good example of this is the Content Security Policy (CSP) supported by modern web browsers. CSP lets you state that the HTML being sent is only data, and is not allowed to provide inline scripts (programs) or styles (which can also be programs) - instead, the scripts and styles may only be downloaded from specified trusted places. That way, if an attacker manages to subvert the HTML, the attacker will not be able to cause attacker-provided programs to be run.

Insecure design is such a common mistake in web applications that it is 2021 OWASP Top 10 #4.

This is called "hardening" a system.